import "server-only";
import type { PrismaClient } from "@prisma/client";

/**
 * AY İÇİNDE BAŞLAYAN / AYRILAN MÜDÜR VE MÜDÜR YARDIMCISI (sahibi, 16.11.2026).
 *
 * Bu profillerin komisyonu MAĞAZA cirosuna bakar. Kişi ayın tamamında
 * çalışmadıysa ayın tamamının cirosunu almak haksızdır: komisyon, çalıştığı
 * tarih aralığının mağaza cirosundan hesaplanır ve hedef de aynı aralığa
 * TAKVİM GÜNÜYLE oranlanır (başarı oranı elma ile elma karşılaştırılsın).
 *
 * Örnek — Sedanur Çiçek, Mavi Girne, 09–25 Ekim 2026:
 *   dönem cirosu 3.294.224,91 ÷ (5.600.000 × 17/31 = 3.070.967,74) = %107,27
 *   → müdür %0,30 × 0,75 = %0,225 → 7.412,01  (ayın tamamıyla 10.943,13 olurdu)
 *
 * Satış asistanlarına uygulanmaz: onların kendi ciroları zaten yalnız
 * çalıştıkları günleri kapsar.
 */

/** Mağaza cirosuna bakan profiller. */
const STORE_BASIS_PROFILES = new Set(["mavi_mudur", "mavi_vice", "deri_mudur"]);

export function usesStoreBasis(profile: string): boolean {
  return STORE_BASIS_PROFILES.has(profile);
}

export type PartialRange = { from: string; to: string; days: number; month_days: number };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Kişinin ay içindeki çalışma aralığı. Ayın tamamını kapsıyorsa null
 * (olağan durum — hesap değişmez).
 */
export function partialRange(
  year: number,
  month: number,
  start: Date | null | undefined,
  end: Date | null | undefined
): PartialRange | null {
  const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = `${year}-${String(month).padStart(2, "0")}-${String(monthDays).padStart(2, "0")}`;
  const s = start ? iso(start) : null;
  const e = end ? iso(end) : null;
  const from = s && s > first ? s : first;
  const to = e && e < last ? e : last;
  if (from === first && to === last) return null;
  if (from > to) return { from, to, days: 0, month_days: monthDays };
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  return { from, to, days, month_days: monthDays };
}

/** Hedefi aynı aralığa oranla: aylık hedef × gün / ayın günü. */
export function prorateTarget(monthTarget: number | null, r: PartialRange): number | null {
  if (!monthTarget || monthTarget <= 0) return monthTarget ?? null;
  return Math.round(((monthTarget * r.days) / r.month_days) * 100) / 100;
}

/**
 * Bir mağazanın belirli tarih aralığındaki cirosu.
 * Mavi → SAP bayi raporu kişi satırları (DealerDailyRep, ay toplamıyla aynı kaynak).
 * Derimod → Nebim KDV matrahı (derimodMonthRevenue ile aynı taban).
 */
export async function storeRevenueForRange(
  prisma: PrismaClient,
  opts: { storeId: string; brandName: string; from: string; to: string }
): Promise<number | null> {
  const from = new Date(`${opts.from}T00:00:00.000Z`);
  const to = new Date(`${opts.to}T00:00:00.000Z`);
  if (/mavi/i.test(opts.brandName)) {
    const g = await prisma.dealerDailyRep.aggregate({
      where: { store_id: opts.storeId, report_date: { gte: from, lte: to } },
      _sum: { net_ciro: true },
      _count: true,
    });
    if (g._count === 0) return null;
    return Math.round(Number(g._sum.net_ciro ?? 0) * 100) / 100;
  }
  const g = await prisma.nebimSaleLine.aggregate({
    where: { store_id: opts.storeId, invoice_date: { gte: from, lte: to } },
    _sum: { tax_base: true },
    _count: true,
  });
  if (g._count === 0) return null;
  return Math.round(Number(g._sum.tax_base ?? 0) * 100) / 100;
}

export type PartialBasis = {
  line_id: string;
  range: PartialRange;
  revenue: number;
  target: number | null;
  note: string;
};

const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (s: string) => s.split("-").reverse().join(".");

/**
 * Dönemdeki kısmi aylı mağaza-cirolu satırlar için ciro/hedef. Ciro verisi
 * yoksa (bayi dosyaları eksik) satır atlanır → eski davranış sürer.
 */
export async function partialBasesForPeriod(
  prisma: PrismaClient,
  period: { id: string; year: number; month: number },
  lines: Array<{
    id: string;
    store_id: string;
    commission_profile: string;
    employee: { start_date: Date | null; end_date: Date | null };
  }>,
  stores: Map<string, { name: string; brand: string; target: number | null }>
): Promise<Map<string, PartialBasis>> {
  const out = new Map<string, PartialBasis>();
  for (const l of lines) {
    if (!usesStoreBasis(l.commission_profile)) continue;
    const r = partialRange(period.year, period.month, l.employee.start_date, l.employee.end_date);
    if (!r || r.days <= 0) continue;
    const st = stores.get(l.store_id);
    if (!st) continue;
    const revenue = await storeRevenueForRange(prisma, {
      storeId: l.store_id,
      brandName: st.brand,
      from: r.from,
      to: r.to,
    });
    if (revenue == null) continue;
    const target = prorateTarget(st.target, r);
    out.set(l.id, {
      line_id: l.id,
      range: r,
      revenue,
      target,
      note:
        `Kısmi ay: ${dmy(r.from)} – ${dmy(r.to)} (${r.days}/${r.month_days} gün). ` +
        `Dönem cirosu ${fmt(revenue)}` +
        (target ? ` ÷ oranlanmış hedef ${fmt(target)}` : "") +
        ".",
    });
  }
  return out;
}

/**
 * Tek satır için kısmi taban (lines.get, bordro fişi). Ayın tamamıysa null.
 */
export async function partialBasisForLine(
  prisma: PrismaClient,
  l: {
    id: string;
    store_id: string;
    commission_profile: string;
    employee: { start_date: Date | null; end_date: Date | null };
    store: { name: string; brand?: { name: string } | null };
    period: { year: number; month: number };
  },
  monthTarget: number | null
): Promise<{ revenue: number; target: number | null; note: string } | null> {
  if (!usesStoreBasis(l.commission_profile)) return null;
  const r = partialRange(l.period.year, l.period.month, l.employee.start_date, l.employee.end_date);
  if (!r || r.days <= 0) return null;
  const brand = l.store.brand?.name ?? "";
  const revenue = await storeRevenueForRange(prisma, { storeId: l.store_id, brandName: brand, from: r.from, to: r.to });
  if (revenue == null) return null;
  const target = prorateTarget(monthTarget, r);
  const m = await partialBasesForPeriod(
    prisma,
    { id: "", year: l.period.year, month: l.period.month },
    [{ id: l.id, store_id: l.store_id, commission_profile: l.commission_profile, employee: l.employee }],
    new Map([[l.store_id, { name: l.store.name, brand, target: monthTarget }]])
  );
  const hit = m.get(l.id);
  return hit ? { revenue: hit.revenue, target: hit.target, note: hit.note } : { revenue, target, note: "" };
}
