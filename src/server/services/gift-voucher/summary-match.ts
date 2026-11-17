import type { PrismaClient } from "@prisma/client";

/**
 * HEDİYE ÇEKİ ↔ MAĞAZA ÖZETİ MUTABAKATI (sahibi, 17.11.2026).
 *
 * "Derimodların mağaza özetinde Derimod Hediye Çeki diye ne kadar kullandıysa
 * belirtiyor ama o BARKODLU olanları söyleyebiliyor; en azından barkodlu gelen
 * hediye çeklerinin sisteme işlendiğinin kontrolü yapılması gerek — özetteki
 * hediye çeki ile birebir örtüşürse tamamdır."
 *
 * Nebim özeti kasadan geçen çeki yazar; biz de okutulan çekleri toplarız. İki
 * rakam birebir tutuyorsa o günün barkodlu çeklerinin hepsi sisteme girilmiş
 * demektir. Tutmuyorsa eksik (ya da fazladan) okutma vardır.
 *
 * BARKODSUZ eski çekler bu denetimin dışındadır: Nebim onları da kasada
 * gösterebilir ama barkodsuz okutmada tutar elle girildiği için fark çıkması
 * her zaman hata anlamına gelmez — bu yüzden sonuç uyarıdır, kilit engeli değil.
 */

export type GiftVoucherMatchState =
  /** Özetteki tutar okutulan çeklerle birebir aynı. */
  | "match"
  /** Özet daha fazla gösteriyor: okutulmamış çek var. */
  | "missing"
  /** Okutulan çekler özetten fazla: fazladan ya da yanlış güne okutulmuş. */
  | "extra"
  /** Özette Hediye Çeki satırı yok (o gün çek kullanılmamış). */
  | "no_row"
  /** Gün için mağaza özeti henüz yüklenmemiş. */
  | "no_summary"
  /** Özet, bu alan okunmaya başlamadan önce analiz edilmiş. */
  | "unread";

export type GiftVoucherMatch = {
  /** Sisteme okutulan çeklerin toplamı (aralık birleşikse tüm günler). */
  scanned_total: number;
  scanned_count: number;
  /** Mağaza özetindeki "Hediye Çeki" tutarı; okunamadıysa null. */
  summary_total: number | null;
  /** summary_total − scanned_total */
  diff: number;
  state: GiftVoucherMatchState;
  /** Özetin kapsadığı aralık (birleşik günlerde birden çok gün). */
  from: string;
  to: string;
  merged: boolean;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const num = (d: { toNumber(): number } | null | undefined) => d?.toNumber() ?? 0;
/** Kuruş kuruşuna karşılaştırma; kayan nokta gürültüsü dışarıda. */
const EPS = 0.005;

type SummaryHit = {
  parsed: Record<string, unknown> | null;
  period_start: Date | null;
  period_end: Date | null;
};

/**
 * Günü kapsayan mağaza özeti. Birleşik günlerde özet grubun tek bir gününe
 * bağlıdır ama period_start–period_end tüm grubu kapsar, bu yüzden önce günün
 * kendi özetine, sonra aralığı bu günü içeren özete bakılır.
 */
async function findSummary(prisma: PrismaClient, storeId: string, dateIso: string): Promise<SummaryHit | null> {
  const d = day(dateIso);
  const include = { upload: { select: { parsed_data_json: true } } } as const;
  const own = await prisma.storeSummary.findFirst({
    where: { daily_record: { store_id: storeId, date: d } },
    include,
  });
  const hit =
    own ??
    (await prisma.storeSummary.findFirst({
      where: { daily_record: { store_id: storeId }, period_start: { lte: d }, period_end: { gte: d } },
      include,
    }));
  if (!hit) return null;
  const parsed = hit.upload?.parsed_data_json;
  return {
    parsed: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null,
    period_start: hit.period_start,
    period_end: hit.period_end,
  };
}

export async function giftVoucherSummaryMatch(
  prisma: PrismaClient,
  storeId: string,
  dateIso: string
): Promise<GiftVoucherMatch> {
  const summary = await findSummary(prisma, storeId, dateIso);
  const from = summary?.period_start ? iso(summary.period_start) : dateIso;
  const to = summary?.period_end ? iso(summary.period_end) : dateIso;

  const g = await prisma.giftVoucherClaim.aggregate({
    where: { used_store_id: storeId, used_date: { gte: day(from), lte: day(to) } },
    _sum: { amount: true },
    _count: true,
  });
  const scanned_total = Math.round(num(g._sum.amount) * 100) / 100;
  const base = { scanned_total, scanned_count: g._count, from, to, merged: from !== to };

  if (!summary) return { ...base, summary_total: null, diff: 0, state: "no_summary" };

  // Alan hiç yoksa özet bu denetimden ÖNCE analiz edilmiştir — "satır yok" ile
  // karıştırılmaz, yoksa eski günlerin hepsi yanlış alarm verir.
  if (!summary.parsed || !("gift_voucher_used" in summary.parsed))
    return { ...base, summary_total: null, diff: 0, state: "unread" };

  const raw = summary.parsed.gift_voucher_used;
  // Satır yok + okutulmuş çek de yok → o gün çek kullanılmamış, denetlenecek
  // bir şey yok. Satır yok ama çek okutulmuşsa bu da bir uyuşmazlıktır
  // (yanlış güne / yanlış mağazaya okutulmuş olabilir) — 0 ile karşılaştırılır.
  if (raw == null || typeof raw !== "number") {
    if (scanned_total <= EPS) return { ...base, summary_total: null, diff: 0, state: "no_row" };
    return { ...base, summary_total: 0, diff: -scanned_total, state: "extra" };
  }

  const summary_total = Math.round(Math.abs(raw) * 100) / 100;
  const diff = Math.round((summary_total - scanned_total) * 100) / 100;
  return {
    ...base,
    summary_total,
    diff,
    state: Math.abs(diff) <= EPS ? "match" : diff > 0 ? "missing" : "extra",
  };
}
