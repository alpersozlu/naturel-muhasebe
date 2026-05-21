import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { AnalyticsFilter } from "@/lib/zod-schemas/analytics";
import { TOLERANCE_TL } from "@/lib/constants";

/**
 * Z Raporu Analizi
 *
 * Toplam Z = Z.net_sales_try + Σ ManualInvoice.amount_try
 *
 * İş kuralı:
 *   Alt sınır:
 *     - Nakit > 0 → Toplam Z ≥ Visa × 1.05
 *     - Nakit = 0 → Toplam Z ≥ Visa
 *   Üst sınır:
 *     - Toplam Z ≤ StoreSummary.sales_total_try
 *
 * Mağaza × ay bazında compliance + el faturası / Z raporu ayrımı.
 */

export type StoreMonthZ = {
  store_id: string;
  store_name: string;
  brand_name: string;
  z_report_total: number; // Sadece Z raporu fişlerinden
  manual_invoice_total: number; // El faturası
  combined: number; // = z_report_total + manual_invoice_total
  visa_total: number; // POS slip toplamı
  cash_total: number; // Nakit
  sales_total: number; // Mağaza özeti satış toplamı
  /** Bu mağazanın günlük detayı — drill-down için */
  days: Array<{
    date: string;
    z_report_total: number;
    manual_invoice_total: number;
    combined: number;
    visa_total: number;
    cash_total: number;
    sales_total: number;
    compliance: "passed" | "below_visa" | "above_sales" | "incomplete";
  }>;
  /** Aylık özet compliance */
  compliance: "passed" | "below_visa" | "above_sales" | "mixed" | "no_data";
  /** Visa altında olan günlerin toplam eksiği */
  below_visa_days: number;
  above_sales_days: number;
};

export type ZAnalysisSummary = {
  period_label: string;
  // Toplam (tüm mağazalar)
  total_z_report: number;
  total_manual_invoice: number;
  total_combined: number;
  total_visa: number;
  total_sales: number;
  // % oranlar
  manual_invoice_share: number; // 0-1
  z_over_visa_ratio: number; // 0+, ideali ≥ 1.05
  z_over_sales_ratio: number; // 0+
  // Per-store cari ay
  by_store: StoreMonthZ[];
  // 12 aylık trend — sadece toplam (mağaza ayrımı yok, hero için)
  monthly_trend: Array<{
    month_key: string;
    label: string;
    z_report: number;
    manual_invoice: number;
    combined: number;
    visa: number;
  }>;
  // Compliance özeti
  stores_passed: number;
  stores_below_visa: number;
  stores_above_sales: number;
  stores_no_data: number;
};

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

const MONTH_LABELS = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];
const MONTH_FULL = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

const monthKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const ymKey = (y: number, m: number) =>
  `${y}-${String(m).padStart(2, "0")}`;

function dayCompliance(
  combined: number,
  visa: number,
  cash: number,
  sales: number | null
): StoreMonthZ["days"][number]["compliance"] {
  if (sales === null || sales === 0) return "incomplete";
  if (visa <= 0) return "incomplete";

  const cashPresent = cash > TOLERANCE_TL;
  const floor = cashPresent ? visa * 1.05 : visa;
  // Tolerance: tam matematiksel ≥ değil, küçük yuvarlama farklarına izin
  if (combined < floor - TOLERANCE_TL) return "below_visa";
  if (combined > sales + TOLERANCE_TL) return "above_sales";
  return "passed";
}

export async function zAnalysisSummary(
  prisma: PrismaClient,
  filter: AnalyticsFilter
): Promise<ZAnalysisSummary> {
  const currentStart = new Date(Date.UTC(filter.year, filter.month - 1, 1));
  const currentEnd = new Date(Date.UTC(filter.year, filter.month, 1));
  // 12 aylık trend penceresi
  const extStart = new Date(Date.UTC(filter.year, filter.month - 12, 1));

  // Store scope
  let storeIds: string[] | undefined = filter.store_id ? [filter.store_id] : undefined;
  if (!storeIds && filter.brand_id) {
    const stores = await prisma.store.findMany({
      where: { brand_id: filter.brand_id, deleted_at: null },
      select: { id: true },
    });
    storeIds = stores.map((s) => s.id);
  }
  const storeScope = storeIds ? { store_id: { in: storeIds } } : {};

  // Tüm mağazalar listesi (cari ay scope'unda olanlar)
  const allStores = storeIds
    ? await prisma.store.findMany({
        where: { id: { in: storeIds }, deleted_at: null },
        select: { id: true, name: true, brand: { select: { name: true } } },
      })
    : await prisma.store.findMany({
        where: { deleted_at: null },
        select: { id: true, name: true, brand: { select: { name: true } } },
      });

  // 12 aylık veri — Z, ManualInvoice, PosSlip, StoreSummary
  const records = await prisma.dailyRecord.findMany({
    where: {
      date: { gte: extStart, lt: currentEnd },
      ...storeScope,
    },
    include: {
      store: { include: { brand: true } },
      store_summary: {
        select: {
          cash_sales_try: true,
          sales_total_try: true,
          credit_card_total_try: true,
        },
      },
      pos_slips: {
        select: {
          net_amount_try: true,
          upload: { select: { status: true } },
        },
      },
      z_reports: { select: { net_sales_try: true } },
      manual_invoices: { select: { amount_try: true } },
    },
  });

  // Aylık + per-store bucket'lar
  type DayBucket = {
    z_report: number;
    manual_invoice: number;
    visa: number;
    cash: number;
    sales: number | null;
  };
  // monthlyAll: tüm mağazalar birleşik aylık seri (trend için)
  const monthlyAll: Record<
    string,
    { z_report: number; manual_invoice: number; visa: number }
  > = {};
  // currentMonthByStore: cari ay mağaza bazlı, gün detaylı
  const currentMonthByStore: Record<
    string,
    {
      z_report: number;
      manual_invoice: number;
      visa: number;
      cash: number;
      sales: number;
      days: Record<string, DayBucket>;
    }
  > = {};

  for (const dr of records) {
    const mk = monthKey(dr.date);
    const z_report = dr.z_reports.reduce((s, z) => s + num(z.net_sales_try), 0);
    const manual = dr.manual_invoices.reduce((s, m) => s + num(m.amount_try), 0);
    const visa = dr.pos_slips
      .filter((p) => p.upload.status === "parsed" || p.upload.status === "confirmed")
      .reduce((s, p) => s + num(p.net_amount_try), 0);

    monthlyAll[mk] ??= { z_report: 0, manual_invoice: 0, visa: 0 };
    monthlyAll[mk].z_report += z_report;
    monthlyAll[mk].manual_invoice += manual;
    monthlyAll[mk].visa += visa;

    // Cari ay verisi
    if (dr.date >= currentStart && dr.date < currentEnd) {
      const cash = dr.store_summary ? num(dr.store_summary.cash_sales_try) : 0;
      const sales = dr.store_summary ? num(dr.store_summary.sales_total_try) : 0;

      currentMonthByStore[dr.store_id] ??= {
        z_report: 0,
        manual_invoice: 0,
        visa: 0,
        cash: 0,
        sales: 0,
        days: {},
      };
      const bucket = currentMonthByStore[dr.store_id]!;
      bucket.z_report += z_report;
      bucket.manual_invoice += manual;
      bucket.visa += visa;
      bucket.cash += cash;
      bucket.sales += sales;

      const dateKey = dr.date.toISOString().slice(0, 10);
      bucket.days[dateKey] = {
        z_report,
        manual_invoice: manual,
        visa,
        cash,
        sales: dr.store_summary ? sales : null,
      };
    }
  }

  // Per-store yapısı
  const by_store: StoreMonthZ[] = allStores.map((store) => {
    const data = currentMonthByStore[store.id];
    if (!data) {
      return {
        store_id: store.id,
        store_name: store.name,
        brand_name: store.brand.name,
        z_report_total: 0,
        manual_invoice_total: 0,
        combined: 0,
        visa_total: 0,
        cash_total: 0,
        sales_total: 0,
        days: [],
        compliance: "no_data" as const,
        below_visa_days: 0,
        above_sales_days: 0,
      };
    }
    const combined = data.z_report + data.manual_invoice;
    const days = Object.entries(data.days)
      .map(([date, d]) => {
        const dayCombined = d.z_report + d.manual_invoice;
        return {
          date,
          z_report_total: d.z_report,
          manual_invoice_total: d.manual_invoice,
          combined: dayCombined,
          visa_total: d.visa,
          cash_total: d.cash,
          sales_total: d.sales ?? 0,
          compliance: dayCompliance(dayCombined, d.visa, d.cash, d.sales),
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    const below = days.filter((d) => d.compliance === "below_visa").length;
    const above = days.filter((d) => d.compliance === "above_sales").length;
    const passed = days.filter((d) => d.compliance === "passed").length;
    let storeCompliance: StoreMonthZ["compliance"] = "no_data";
    if (days.length > 0) {
      if (below === 0 && above === 0) storeCompliance = "passed";
      else if (below > 0 && above === 0) storeCompliance = "below_visa";
      else if (above > 0 && below === 0) storeCompliance = "above_sales";
      else storeCompliance = "mixed";
      // İncomplete sayıldıysa ama passed günler de varsa, passed kabul et
      if (below === 0 && above === 0 && passed > 0) storeCompliance = "passed";
    }

    return {
      store_id: store.id,
      store_name: store.name,
      brand_name: store.brand.name,
      z_report_total: data.z_report,
      manual_invoice_total: data.manual_invoice,
      combined,
      visa_total: data.visa,
      cash_total: data.cash,
      sales_total: data.sales,
      days,
      compliance: storeCompliance,
      below_visa_days: below,
      above_sales_days: above,
    };
  });

  // Toplam metrikler
  const total_z_report = by_store.reduce((s, x) => s + x.z_report_total, 0);
  const total_manual_invoice = by_store.reduce(
    (s, x) => s + x.manual_invoice_total,
    0
  );
  const total_combined = total_z_report + total_manual_invoice;
  const total_visa = by_store.reduce((s, x) => s + x.visa_total, 0);
  const total_sales = by_store.reduce((s, x) => s + x.sales_total, 0);

  const manual_invoice_share =
    total_combined > 0 ? total_manual_invoice / total_combined : 0;
  const z_over_visa_ratio = total_visa > 0 ? total_combined / total_visa : 0;
  const z_over_sales_ratio = total_sales > 0 ? total_combined / total_sales : 0;

  // 12 aylık trend
  const monthly_trend: ZAnalysisSummary["monthly_trend"] = [];
  for (let offset = 11; offset >= 0; offset--) {
    const d = new Date(Date.UTC(filter.year, filter.month - 1 - offset, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const key = ymKey(y, m);
    const bucket = monthlyAll[key] ?? { z_report: 0, manual_invoice: 0, visa: 0 };
    monthly_trend.push({
      month_key: key,
      label: MONTH_LABELS[m - 1]!,
      z_report: bucket.z_report,
      manual_invoice: bucket.manual_invoice,
      combined: bucket.z_report + bucket.manual_invoice,
      visa: bucket.visa,
    });
  }

  // Compliance özeti
  const stores_passed = by_store.filter((s) => s.compliance === "passed").length;
  const stores_below_visa = by_store.filter(
    (s) => s.compliance === "below_visa" || s.compliance === "mixed"
  ).length;
  const stores_above_sales = by_store.filter(
    (s) => s.compliance === "above_sales"
  ).length;
  const stores_no_data = by_store.filter((s) => s.compliance === "no_data").length;

  return {
    period_label: `${MONTH_FULL[filter.month - 1]} ${filter.year}`,
    total_z_report,
    total_manual_invoice,
    total_combined,
    total_visa,
    total_sales,
    manual_invoice_share,
    z_over_visa_ratio,
    z_over_sales_ratio,
    by_store,
    monthly_trend,
    stores_passed,
    stores_below_visa,
    stores_above_sales,
    stores_no_data,
  };
}
