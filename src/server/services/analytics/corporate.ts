import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { AnalyticsFilter } from "@/lib/zod-schemas/analytics";

/**
 * KURUMSAL & YÖNETİM ALIŞVERİŞİ analizi.
 *
 * - Kurumsal: şirket bazlı gruplama (Kaner altında kişiler + şirket toplamı).
 *   company_name boşsa kişi kendi başına bir grup olur.
 * - Yönetim: kişi bazlı gruplama.
 *
 * Her grup için: bu ayki toplam + yıllık toplam + ödenen + kalan borç.
 * Tek sorguda tüm yılı çeker; ay filtresini JS'te uygular (aylık + yıllık birlikte).
 */
export type CorporateEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  store_name: string;
  person_name: string;
  is_paid: boolean;
  note: string | null;
};

export type CorporateParty = {
  /** Kurumsal: şirket adı (veya şirketsizse kişi adı). Yönetim: kişi adı. */
  name: string;
  /** Kurumsal grup altındaki kişiler (yönetimde boş). */
  people?: { person_name: string; month_total: number; month_debt: number }[];
  month_total: number;
  month_paid: number;
  month_debt: number;
  year_total: number;
  year_debt: number;
  entries: CorporateEntry[]; // sadece seçili ay
};

export type CorporateSummary = {
  period_label: string;
  year: number;
  month: number;
  companies: CorporateParty[]; // kurumsal (şirket bazlı)
  management: CorporateParty[]; // yönetim (kişi bazlı)
  // Seçili ay KPI
  month_total: number;
  month_paid: number;
  month_debt: number;
  // Yıl KPI
  year_total: number;
  year_debt: number;
  entry_count: number;
};

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

const MONTH_LABELS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

type Row = {
  id: string;
  type: "corporate" | "management";
  company_name: string | null;
  person_name: string;
  amount_try: { toNumber: () => number };
  is_paid: boolean;
  note: string | null;
  date: Date;
  store_name: string;
  inMonth: boolean;
};

// Bir partinin (şirket ya da kişi) toplamlarını hesaplar.
function buildParty(name: string, rows: Row[]): CorporateParty {
  let month_total = 0, month_paid = 0, month_debt = 0, year_total = 0, year_debt = 0;
  const entries: CorporateEntry[] = [];
  // Kurumsal grup altında kişi kırılımı (sadece ay)
  const peopleMap = new Map<string, { person_name: string; month_total: number; month_debt: number }>();

  for (const r of rows) {
    const amt = num(r.amount_try);
    year_total += amt;
    if (!r.is_paid) year_debt += amt;
    if (r.inMonth) {
      month_total += amt;
      if (r.is_paid) month_paid += amt;
      else month_debt += amt;
      entries.push({
        id: r.id,
        date: r.date.toISOString().slice(0, 10),
        amount: amt,
        store_name: r.store_name,
        person_name: r.person_name,
        is_paid: r.is_paid,
        note: r.note,
      });
      const pk = r.person_name.toLocaleLowerCase("tr");
      let p = peopleMap.get(pk);
      if (!p) {
        p = { person_name: r.person_name, month_total: 0, month_debt: 0 };
        peopleMap.set(pk, p);
      }
      p.month_total += amt;
      if (!r.is_paid) p.month_debt += amt;
    }
  }

  entries.sort((a, b) => a.date.localeCompare(b.date));
  const people = Array.from(peopleMap.values()).sort((a, b) => b.month_total - a.month_total);

  return { name, people, month_total, month_paid, month_debt, year_total, year_debt, entries };
}

export async function corporateSummary(
  prisma: PrismaClient,
  filter: AnalyticsFilter
): Promise<CorporateSummary> {
  const yearStart = new Date(Date.UTC(filter.year, 0, 1));
  const yearEnd = new Date(Date.UTC(filter.year + 1, 0, 1));
  const monthStart = new Date(Date.UTC(filter.year, filter.month - 1, 1));
  const monthEnd = new Date(Date.UTC(filter.year, filter.month, 1));

  // Mağaza scope
  let storeIds: string[] | undefined = filter.store_id ? [filter.store_id] : undefined;
  if (!storeIds && filter.brand_id) {
    const stores = await prisma.store.findMany({
      where: { brand_id: filter.brand_id, deleted_at: null },
      select: { id: true },
    });
    storeIds = stores.map((s) => s.id);
  }

  const raw = await prisma.corporatePurchase.findMany({
    where: {
      daily_record: {
        date: { gte: yearStart, lt: yearEnd },
        ...(storeIds ? { store_id: { in: storeIds } } : {}),
      },
    },
    select: {
      id: true,
      type: true,
      company_name: true,
      person_name: true,
      amount_try: true,
      is_paid: true,
      note: true,
      daily_record: { select: { date: true, store: { select: { name: true } } } },
    },
  });

  const rows: Row[] = raw.map((r) => ({
    id: r.id,
    type: r.type,
    company_name: r.company_name,
    person_name: r.person_name,
    amount_try: r.amount_try,
    is_paid: r.is_paid,
    note: r.note,
    date: r.daily_record.date,
    store_name: r.daily_record.store.name,
    inMonth: r.daily_record.date >= monthStart && r.daily_record.date < monthEnd,
  }));

  // Kurumsal → şirket adıyla grupla (boşsa kişi adı tek başına grup)
  const corpGroups = new Map<string, Row[]>();
  // Yönetim → kişi adıyla grupla
  const mgmtGroups = new Map<string, Row[]>();

  for (const r of rows) {
    if (r.type === "corporate") {
      const key = (r.company_name?.trim() || r.person_name).toLocaleLowerCase("tr");
      (corpGroups.get(key) ?? corpGroups.set(key, []).get(key)!).push(r);
    } else {
      const key = r.person_name.toLocaleLowerCase("tr");
      (mgmtGroups.get(key) ?? mgmtGroups.set(key, []).get(key)!).push(r);
    }
  }

  const companies = Array.from(corpGroups.values())
    .map((grp) => buildParty(grp[0].company_name?.trim() || grp[0].person_name, grp))
    .sort((a, b) => b.year_total - a.year_total);

  const management = Array.from(mgmtGroups.values())
    .map((grp) => {
      const p = buildParty(grp[0].person_name, grp);
      p.people = undefined; // yönetimde kişi kırılımı yok
      return p;
    })
    .sort((a, b) => b.year_total - a.year_total);

  // KPI toplamları
  let month_total = 0, month_paid = 0, month_debt = 0, year_total = 0, year_debt = 0, entry_count = 0;
  for (const r of rows) {
    const amt = num(r.amount_try);
    year_total += amt;
    if (!r.is_paid) year_debt += amt;
    if (r.inMonth) {
      entry_count++;
      month_total += amt;
      if (r.is_paid) month_paid += amt;
      else month_debt += amt;
    }
  }

  return {
    period_label: `${MONTH_LABELS[filter.month - 1]} ${filter.year}`,
    year: filter.year,
    month: filter.month,
    companies,
    management,
    month_total,
    month_paid,
    month_debt,
    year_total,
    year_debt,
    entry_count,
  };
}
