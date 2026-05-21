import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { AnalyticsFilter } from "@/lib/zod-schemas/analytics";

/**
 * Banka POS Komisyon Gideri Analizi
 *
 * Şu an: tüm bankalar için sabit %5 komisyon.
 * İlerde: getCommissionRate() banka adına göre AppSetting'ten override okuyabilir.
 */

export const DEFAULT_COMMISSION_RATE = 0.05;

/**
 * Banka adına göre komisyon oranı.
 * Şimdilik tüm bankalar için DEFAULT, ilerde per-banka override.
 */
function getCommissionRate(bankName: string): number {
  // İlerde: AppSetting'ten banka adına göre override (örn. "İş Bankası" → 4.5%)
  void bankName;
  return DEFAULT_COMMISSION_RATE;
}

export type BankCommissionSummary = {
  // Cari ay
  total: number; // Bu ay toplam komisyon gideri
  total_gross: number; // POS cirosu (komisyon hesaplandığı taban)
  effective_rate: number; // toplam / toplam_gross — ağırlıklı ortalama
  active_days: number;

  // Trendler
  prev_month_total: number;
  prev_year_total: number;

  // 12-aylık + 3-aylık
  sparkline: Array<{ month_key: string; label: string; total: number; gross: number }>;
  /** Bu yıl ve geçen yıl, ayrı satırlar — yıllık karşılaştırma için */
  yearly_compare: {
    current_ytd: number; // bu yılın 1. ayından cari aya kadar toplam
    prev_ytd: number; // geçen yılın aynı pencere toplamı
    months: Array<{ month: number; label: string; current: number; prev: number }>;
  };

  // Banka kırılımı (cari ay)
  by_bank: Array<{
    bank_name: string;
    gross: number; // bu ay POS cirosu
    rate: number; // şu anki komisyon oranı (0-1)
    commission: number; // gross × rate
    prev_month_commission: number;
    sparkline: Array<{ month_key: string; total: number }>;
  }>;
};

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

const MONTH_LABELS_SHORT = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function ymKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export async function bankCommissionSummary(
  prisma: PrismaClient,
  filter: AnalyticsFilter
): Promise<BankCommissionSummary> {
  const currentStart = new Date(Date.UTC(filter.year, filter.month - 1, 1));
  const currentEnd = new Date(Date.UTC(filter.year, filter.month, 1));
  // YTD karşılaştırma için tüm geçen yıl + bu yılın cari aya kadarki bölümü
  const ytdStart = new Date(Date.UTC(filter.year - 1, 0, 1));

  // Resolve store scope
  let storeIds: string[] | undefined = filter.store_id ? [filter.store_id] : undefined;
  if (!storeIds && filter.brand_id) {
    const stores = await prisma.store.findMany({
      where: { brand_id: filter.brand_id, deleted_at: null },
      select: { id: true },
    });
    storeIds = stores.map((s) => s.id);
  }
  const storeScope = storeIds ? { store_id: { in: storeIds } } : {};

  // Tek query, en geniş pencere — YTD karşılaştırma için ytdStart kullan
  const slips = await prisma.posSlip.findMany({
    where: {
      daily_record: { date: { gte: ytdStart, lt: currentEnd }, ...storeScope },
      upload: { status: { in: ["parsed", "confirmed"] } },
    },
    include: { daily_record: true },
  });

  // ───────────────── Aggregate ─────────────────
  type Bucket = { gross: number; commission: number };
  const monthlyAll: Record<string, Bucket> = {};
  const monthlyByBank: Record<string, Record<string, Bucket>> = {};

  // Cari ay banka kırılımı için
  const currentByBank: Record<string, { gross: number; commission: number }> = {};
  const currentActiveDays = new Set<string>();
  let currentTotalGross = 0;
  let currentTotalCommission = 0;

  for (const p of slips) {
    const date = p.daily_record.date;
    const mk = monthKey(date);
    const bank = p.bank_name ?? "Bilinmeyen";
    const gross = num(p.net_amount_try);
    const rate = getCommissionRate(bank);
    const commission = gross * rate;

    monthlyAll[mk] ??= { gross: 0, commission: 0 };
    monthlyAll[mk].gross += gross;
    monthlyAll[mk].commission += commission;

    monthlyByBank[bank] ??= {};
    monthlyByBank[bank]![mk] ??= { gross: 0, commission: 0 };
    monthlyByBank[bank]![mk]!.gross += gross;
    monthlyByBank[bank]![mk]!.commission += commission;

    if (date >= currentStart && date < currentEnd) {
      currentTotalGross += gross;
      currentTotalCommission += commission;
      currentActiveDays.add(date.toISOString());
      currentByBank[bank] ??= { gross: 0, commission: 0 };
      currentByBank[bank]!.gross += gross;
      currentByBank[bank]!.commission += commission;
    }
  }

  // ───────────────── Sparkline (12 ay) ─────────────────
  const sparkline: BankCommissionSummary["sparkline"] = [];
  for (let offset = 11; offset >= 0; offset--) {
    const d = new Date(Date.UTC(filter.year, filter.month - 1 - offset, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const key = ymKey(y, m);
    const bucket = monthlyAll[key] ?? { gross: 0, commission: 0 };
    sparkline.push({
      month_key: key,
      label: MONTH_LABELS_SHORT[m - 1]!,
      total: bucket.commission,
      gross: bucket.gross,
    });
  }

  // ───────────────── Yıllık karşılaştırma (12 ay, bu yıl vs geçen yıl) ─────────────────
  const yearlyMonths: BankCommissionSummary["yearly_compare"]["months"] = [];
  let currentYtd = 0;
  let prevYtd = 0;
  for (let m = 1; m <= 12; m++) {
    const curKey = ymKey(filter.year, m);
    const prevKey = ymKey(filter.year - 1, m);
    const cur = monthlyAll[curKey]?.commission ?? 0;
    const prev = monthlyAll[prevKey]?.commission ?? 0;
    yearlyMonths.push({
      month: m,
      label: MONTH_LABELS_SHORT[m - 1]!,
      current: cur,
      prev,
    });
    if (m <= filter.month) {
      currentYtd += cur;
      prevYtd += prev;
    }
  }

  // ───────────────── Prev month / Prev year (same month) ─────────────────
  const prevMonthDate = new Date(Date.UTC(filter.year, filter.month - 2, 1));
  const prevMonthKey = ymKey(prevMonthDate.getUTCFullYear(), prevMonthDate.getUTCMonth() + 1);
  const prev_month_total = monthlyAll[prevMonthKey]?.commission ?? 0;
  const prevYearKey = ymKey(filter.year - 1, filter.month);
  const prev_year_total = monthlyAll[prevYearKey]?.commission ?? 0;

  // ───────────────── By bank (cari ay + 12-aylık spark) ─────────────────
  const by_bank: BankCommissionSummary["by_bank"] = Object.entries(currentByBank)
    .map(([bank, v]) => {
      const months = monthlyByBank[bank] ?? {};
      const prevCommission = months[prevMonthKey]?.commission ?? 0;
      const bankSpark: Array<{ month_key: string; total: number }> = [];
      for (let offset = 11; offset >= 0; offset--) {
        const d = new Date(Date.UTC(filter.year, filter.month - 1 - offset, 1));
        const key = ymKey(d.getUTCFullYear(), d.getUTCMonth() + 1);
        bankSpark.push({ month_key: key, total: months[key]?.commission ?? 0 });
      }
      return {
        bank_name: bank,
        gross: v.gross,
        rate: getCommissionRate(bank),
        commission: v.commission,
        prev_month_commission: prevCommission,
        sparkline: bankSpark,
      };
    })
    .sort((a, b) => b.commission - a.commission);

  return {
    total: currentTotalCommission,
    total_gross: currentTotalGross,
    effective_rate: currentTotalGross > 0 ? currentTotalCommission / currentTotalGross : 0,
    active_days: currentActiveDays.size,
    prev_month_total,
    prev_year_total,
    sparkline,
    yearly_compare: {
      current_ytd: currentYtd,
      prev_ytd: prevYtd,
      months: yearlyMonths,
    },
    by_bank,
  };
}
