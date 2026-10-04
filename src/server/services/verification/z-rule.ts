import "server-only";
import type { PrismaClient } from "@prisma/client";

/**
 * Z raporu onay kuralı — kullanıcının iş kuralı:
 *
 *   Toplam Z = Σ(günün TÜM Z raporları: parsed/confirmed) + Σ(ManualInvoice.amount_try)
 *     Yazar kasa bir günde iki Z kesebilir (Mavi Güzelyurt 30.09.2026: Z-1116
 *     42.650 + Z-1117 8.506). Kural tek tek Z'ye değil günün toplamına bakar
 *     (sahibi, 01.10.2026); tek Z'ye bakınca ikisi de "Visa altı" çıkıyordu.
 *
 *   KESİN alt sınır (asla onaylanmaz):
 *     - Toplam Z ≥ Visa   → Z, Visa'nın ALTINDA olamaz. İstisnası yoktur.
 *
 *   UYARI eşiği (onayı engellemez):
 *     - Nakit varsa Toplam Z'in Visa × 1.05'i geçmesi beklenir. Z ile Visa
 *       eşit/çok yakınsa kayıt yine de onaylanır ama uyarı düşer — nakit
 *       satış varken Z'in Visa'ya eşit çıkması olağan değildir, kontrol
 *       edilmesi istenir.
 *
 *   Üst sınır:
 *     - Toplam Z ≤ StoreSummary.sales_total_try  (toplam satıştan fazla olamaz)
 *
 * KK eşik kaynağı: aynı daily_record altındaki PARSED/CONFIRMED POS
 * sliplerinin net_amount_try toplamı.
 */

export type ZApprovalCheck = {
  passed: boolean;
  reasons: string[]; // ENGELLEYİCİ — boş ise onaylanabilir
  /** Onayı engellemeyen ama gösterilmesi gereken uyarılar */
  warnings: string[];
  combined: number; // Σ Z + manual invoices
  /** Günün toplanan Z raporları — "Z-1116 42.650 + Z-1117 8.506" gibi gösterim için. */
  z_parts: Array<{ report_no: string | null; net: number }>;
  manual_invoice_total: number;
  cc_total: number;
  /** Mağaza özetinin kart satışı (varsa); taban = max(POS, özet kart). */
  summary_card: number | null;
  /** KESİN alt sınır = Visa. Bunun altı asla onaylanmaz. */
  cc_hard_floor: number | null;
  /** Beklenen alt sınır: nakit varsa Visa × 1.05, yoksa Visa. */
  cc_floor: number | null;
  total_sales: number | null;
  /** Nakit > 0 → 5% cushion BEKLENİYOR (zorunlu değil) */
  cash_present: boolean;
};

const TRY_FMT = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

export async function checkZApproval(
  prisma: PrismaClient,
  uploadId: string
): Promise<ZApprovalCheck | null> {
  const dayInclude = {
    store_summary: true,
    manual_invoices: true,
    pos_slips: { include: { upload: { select: { status: true } } } },
    z_reports: { include: { upload: { select: { id: true, status: true } } } },
  } as const;
  const z = await prisma.zReport.findUnique({
    where: { upload_id: uploadId },
    include: { daily_record: { include: dayInclude } },
  });
  if (!z) return null;

  // Birleşik günler (gün / kasa birleşmesi) TEK gün gibi değerlendirilir —
  // doğrulama motoruyla aynı: grubun bütün Z'leri, el faturaları ve POS
  // fişleri, son gündeki tek mağaza özetine karşı. Tek tek bakınca ilk günün
  // Z'si "özet yok" diye hiç onaylanamıyordu.
  const scope = z.daily_record.merge_group_id
    ? await prisma.dailyRecord.findMany({
        where: { merge_group_id: z.daily_record.merge_group_id },
        orderBy: { date: "asc" },
        include: dayInclude,
      })
    : [z.daily_record];
  const scopeSummary = scope.find((r) => r.store_summary !== null)?.store_summary ?? null;

  // Günün bütün Z raporları (bu yükleme dahil; başarısız/bekleyen olanlar hariç).
  const dayZs = scope
    .flatMap((r) => r.z_reports)
    .filter((r) => r.upload.id === uploadId || r.upload.status === "parsed" || r.upload.status === "confirmed");
  const z_parts = dayZs.map((r) => ({ report_no: r.report_no, net: num(r.net_sales_try) }));
  const net_z = z_parts.reduce((s, p) => s + p.net, 0);
  const invoicesSum = scope
    .flatMap((r) => r.manual_invoices)
    .reduce((s, inv) => s + num(inv.amount_try), 0);
  const combined = net_z + invoicesSum;

  // KK eşiği: POS slipleri toplamı (parsed/confirmed olanlar). Z'den KK okunmaz.
  const cc_total = scope
    .flatMap((r) => r.pos_slips)
    .filter((p) => p.upload.status === "parsed" || p.upload.status === "confirmed")
    .reduce((s, p) => s + num(p.net_amount_try), 0);
  // Taban = mağazanın SİSTEME YÜKLEDİĞİ POS fişlerinin toplamı (sahibi,
  // 01.10.2026: "Mavi'nin sistemine girdikleri POS'lara değil, sisteme
  // yükledikleri POS'lara bak" — Mavi Lefkoşa 01.10: SAP kart 305.393,80,
  // fişler 292.094,00, Z 305.095 geçmeli). Özetteki kart satışı yalnız hiç
  // fiş yüklenmediyse taban olur; fişlerden yüksekse uyarı düşer.
  const summary_card = scopeSummary ? num(scopeSummary.credit_card_total_try) : null;
  const hardFloorBase = cc_total > 0 ? cc_total : (summary_card ?? 0);

  const cashSales = scopeSummary ? num(scopeSummary.cash_sales_try) : 0;
  const cashPresent = cashSales > 0.01;
  // KESİN sınır her zaman kart satışıdır. %5 payı yalnız BEKLENTİdir (uyarı).
  const cc_hard_floor = hardFloorBase > 0 ? hardFloorBase : null;
  const cc_floor =
    hardFloorBase > 0 ? (cashPresent ? hardFloorBase * 1.05 : hardFloorBase) : null;

  const total_sales = scopeSummary ? num(scopeSummary.sales_total_try) : null;

  const reasons: string[] = [];
  const warnings: string[] = [];

  const zLabel =
    z_parts.length > 1
      ? `Toplam Z = ${z_parts
          .map((p) => `${p.report_no ? `Z-${p.report_no}` : "Z"} ${TRY_FMT.format(p.net)}`)
          .join(" + ")}${invoicesSum > 0 ? ` + El faturası ${TRY_FMT.format(invoicesSum)}` : ""} = ${TRY_FMT.format(combined)} ₺`
      : `Toplam Z ${TRY_FMT.format(combined)} ₺`;
  const floorLabel =
    cc_total > 0
      ? `Visa (yüklenen POS fişleri) ${TRY_FMT.format(hardFloorBase)} ₺`
      : `kart satışı ${TRY_FMT.format(hardFloorBase)} ₺ (özet; POS fişi yüklenmedi)`;
  if (summary_card !== null && cc_total > 0 && summary_card > cc_total + 1) {
    warnings.push(
      `Özet/SAP kart satışı ${TRY_FMT.format(summary_card)} ₺, yüklenen POS fişleri ${TRY_FMT.format(
        cc_total
      )} ₺ — fark ${TRY_FMT.format(summary_card - cc_total)} ₺. Kural yüklenen fişlere bakar; eksik POS fişi veya POS dışı kart tahsilatı olabilir.`
    );
  } else if (cc_total <= 0 && (summary_card ?? 0) > 0) {
    warnings.push(`POS fişi yüklenmedi — özetteki kart satışı ${TRY_FMT.format(summary_card ?? 0)} ₺ taban alındı.`);
  }

  // 1. KESİN alt sınır — günün Toplam Z'si kart satışının altında olamaz (istisnasız).
  if (cc_hard_floor !== null && combined < cc_hard_floor) {
    reasons.push(
      `${zLabel} — ${floorLabel}'nın ALTINDA olamaz. Bu kuralın istisnası yoktur.${
        z_parts.length > 1 ? " (Günün bütün Z raporları toplandı.)" : ""
      }`
    );
  } else if (cc_floor !== null && combined < cc_floor) {
    // Taban ile taban×1.05 arasında: onaylanır, ama nakit varken Z'in kart
    // satışına bu kadar yakın olması beklenmez — uyarı düşür.
    warnings.push(
      `Nakit satış var ama ${zLabel} kart satışına çok yakın. Beklenen en az ${TRY_FMT.format(
        cc_floor
      )} ₺ (${floorLabel} × 1.05). Onaylandı — nakit satışın Z'e işlendiğini kontrol et.`
    );
  } else if (cc_floor === null) {
    reasons.push(
      "Henüz POS fişi yüklenmedi — Z alt sınırı (Visa eşiği) hesaplanamıyor. POS fişlerini yükleyince tekrar değerlendirilecek."
    );
  }

  // 2. Üst sınır kontrolü — günün Toplam Z'si toplam satıştan fazla olamaz
  //    (iki Z toplanınca da).
  if (total_sales !== null && combined > total_sales) {
    reasons.push(
      `${zLabel} Mağaza Özeti'ndeki toplam satıştan (${TRY_FMT.format(
        total_sales
      )} ₺) fazla olamaz.${z_parts.length > 1 ? " İki Z'nin toplamı satışı aşıyor — biri bu güne ait olmayabilir." : ""}`
    );
  } else if (total_sales === null) {
    reasons.push(
      "Mağaza Özeti henüz yüklenmedi — üst sınır (toplam satış) kontrolü Mağaza Özeti yüklendiğinde tekrar değerlendirilecek."
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
    warnings,
    combined,
    z_parts,
    manual_invoice_total: invoicesSum,
    cc_total,
    summary_card,
    cc_hard_floor,
    cc_floor,
    total_sales,
    cash_present: cashPresent,
  };
}
