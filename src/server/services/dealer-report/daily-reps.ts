import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { ParsedDealerReport } from "./mavi-sap-parser";

/**
 * Per-salesperson revenue, day by day, from the SAP "bayi gün sonu" exports.
 *
 * WHY. Month-end premiums are paid on each sales assistant's "Net Ciro". The
 * documents that state it (BI report, KPI file, IT POS screens) all arrive
 * once, at month end, from the store. The daily export is uploaded every
 * evening for a different purpose (the day's reconciliation) and the day is
 * then locked — so by month end the same figure can be rebuilt from ~30 files
 * that nobody can go back and change. That rebuilt figure is the independent
 * check on the month-end documents.
 *
 * TWO SOURCES for a day:
 *   "upload"   the store's own upload for THAT day — authoritative, always
 *              replaces what is on file.
 *   "archive"  any other appearance of the day: the three earlier days every
 *              export also carries, or an older file handed in later. Fills a
 *              gap; never overrides an "upload" row. Between two archive
 *              copies the one with more lines wins (an export taken before
 *              closing time is the shorter one).
 */
export type RepImportResult = {
  store_code: string | null;
  has_rep_columns: boolean;
  /** ISO days written (new, or replacing an older copy). */
  written: string[];
  /** ISO days already on file and left as they were. */
  kept: string[];
  /** Days left as they were although this file states a different total. */
  mismatched: Array<{ date: string; on_file: number; in_file: number }>;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;

export async function saveReportReps(
  prisma: PrismaClient,
  opts: {
    storeId: string;
    report: ParsedDealerReport;
    sapOriginal: boolean | null;
    /** The day this file was uploaded FOR (daily flow). */
    primary?: { date: Date; dailyRecordId: string } | null;
  }
): Promise<RepImportResult> {
  const days = opts.report.days.filter((d) => d.reps.length > 0);
  const result: RepImportResult = {
    store_code: opts.report.store_code,
    has_rep_columns: days.length > 0,
    written: [],
    kept: [],
    mismatched: [],
  };
  if (days.length === 0) return result;

  const onFile = await prisma.dealerDailyRep.findMany({
    where: { store_id: opts.storeId, report_date: { gte: days[0]!.date, lte: days[days.length - 1]!.date } },
    select: { report_date: true, source: true, line_count: true, net_ciro: true, sap_original: true },
  });
  const existing = new Map<string, { source: string; lines: number; net: number; original: boolean | null }>();
  for (const r of onFile) {
    const k = iso(r.report_date);
    const e = existing.get(k) ?? { source: r.source, lines: 0, net: 0, original: r.sap_original };
    e.lines += r.line_count;
    e.net += Number(r.net_ciro);
    existing.set(k, e);
  }

  const primaryKey = opts.primary ? iso(opts.primary.date) : null;
  for (const day of days) {
    const key = iso(day.date);
    const ex = existing.get(key);
    const lines = day.reps.reduce((s, p) => s + p.lines, 0);
    const total = day.reps.reduce((s, p) => s + p.net_ciro, 0);
    const isPrimary = key === primaryKey;

    let source: "upload" | "archive" | null = null;
    if (isPrimary) source = "upload";
    else if (!ex) source = "archive";
    else if (ex.source === "archive" && (lines > ex.lines || (lines === ex.lines && opts.sapOriginal === true && ex.original !== true))) source = "archive";

    if (!source) {
      result.kept.push(key);
      if (Math.abs(ex!.net - total) > 0.05) result.mismatched.push({ date: key, on_file: r2(ex!.net), in_file: r2(total) });
      continue;
    }
    await prisma.$transaction([
      prisma.dealerDailyRep.deleteMany({ where: { store_id: opts.storeId, report_date: day.date } }),
      prisma.dealerDailyRep.createMany({
        data: day.reps.map((p) => ({
          store_id: opts.storeId,
          report_date: day.date,
          rep_code: p.code,
          rep_name: p.name,
          matrah: p.matrah,
          net_inc_vat: p.net,
          kartus: p.kartus,
          net_ciro: p.net_ciro,
          units: p.units,
          denim_est: p.denim,
          denim_units_est: p.denim_units,
          itpos_extra: p.itpos_extra,
          line_count: p.lines,
          source: source!,
          sap_original: opts.sapOriginal,
          daily_record_id: isPrimary ? opts.primary!.dailyRecordId : null,
        })),
      }),
    ]);
    result.written.push(key);
  }
  return result;
}

/** One store's month, rebuilt from the daily files. */
export type DailyRepMonth = {
  /** Days of the month that are already over (the running day is not expected yet). */
  days_expected: number;
  days_present: number;
  days_missing: string[]; // ISO
  month_over: boolean;
  /** The month is over and every one of its days is on file. */
  complete: boolean;
  upload_days: number;
  archive_days: number;
  /** Days whose file was re-saved outside SAP. */
  not_original_days: string[];
  store_net: number;
  persons: Array<{
    code: string;
    name: string;
    net_ciro: number;
    kartus: number;
    units: number;
    days: number;
    /** Estimated denim revenue (product-name rule) — null when any of the person's days lacks it. */
    denim_est: number | null;
    denim_units_est: number | null;
    /**
     * How much HIGHER SAP's IT POS per-salesperson table shows this person
     * than net_ciro (shared receipts paid partly with Kartuş — see
     * mavi-sap-parser.ts "TWO SAP FIGURES"). null when any of the person's
     * days lacks the information.
     */
    itpos_extra: number | null;
  }>;
};

/** Today's date where the stores are (UTC+3, no daylight saving). */
function storeToday(): string {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}

export async function loadMonthReps(
  prisma: PrismaClient,
  storeIds: string[],
  year: number,
  month: number
): Promise<Map<string, DailyRepMonth>> {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const rows = storeIds.length
    ? await prisma.dealerDailyRep.findMany({
        where: { store_id: { in: storeIds }, report_date: { gte: from, lt: to } },
        orderBy: { report_date: "asc" },
      })
    : [];

  const today = storeToday();
  const allDays: string[] = [];
  for (let d = new Date(from); d < to; d = new Date(d.getTime() + 86_400_000)) allDays.push(iso(d));
  const expected = allDays.filter((d) => d < today);
  const month_over = expected.length === allDays.length;

  const out = new Map<string, DailyRepMonth>();
  for (const storeId of storeIds) {
    const mine = rows.filter((r) => r.store_id === storeId);
    const dayInfo = new Map<string, { source: string; original: boolean | null }>();
    const persons = new Map<
      string,
      {
        code: string;
        name: string;
        net: number;
        kartus: number;
        units: number;
        days: Set<string>;
        denim: number;
        denimUnits: number;
        denimKnown: boolean;
        extra: number;
        extraKnown: boolean;
      }
    >();
    let store = 0;
    for (const r of mine) {
      const k = iso(r.report_date);
      dayInfo.set(k, { source: r.source, original: r.sap_original });
      const p =
        persons.get(r.rep_code) ??
        {
          code: r.rep_code,
          name: r.rep_name,
          net: 0,
          kartus: 0,
          units: 0,
          days: new Set<string>(),
          denim: 0,
          denimUnits: 0,
          denimKnown: true,
          extra: 0,
          extraKnown: true,
        };
      if (r.itpos_extra == null) p.extraKnown = false;
      else p.extra += Number(r.itpos_extra);
      if (r.denim_est == null) p.denimKnown = false;
      else {
        p.denim += Number(r.denim_est);
        p.denimUnits += Number(r.denim_units_est ?? 0);
      }
      p.name = r.rep_name; // rows are in date order — the latest spelling wins
      p.net += Number(r.net_ciro);
      p.kartus += Number(r.kartus);
      p.units += Number(r.units);
      p.days.add(k);
      persons.set(r.rep_code, p);
      store += Number(r.net_ciro);
    }
    const days_missing = expected.filter((d) => !dayInfo.has(d));
    out.set(storeId, {
      days_expected: expected.length,
      days_present: dayInfo.size,
      days_missing,
      month_over,
      complete: month_over && days_missing.length === 0 && dayInfo.size > 0,
      upload_days: Array.from(dayInfo.values()).filter((d) => d.source === "upload").length,
      archive_days: Array.from(dayInfo.values()).filter((d) => d.source !== "upload").length,
      not_original_days: Array.from(dayInfo.entries())
        .filter(([, d]) => d.original === false)
        .map(([k]) => k),
      store_net: r2(store),
      persons: Array.from(persons.values())
        .map((p) => ({
          code: p.code,
          name: p.name,
          net_ciro: r2(p.net),
          kartus: r2(p.kartus),
          units: r2(p.units),
          days: p.days.size,
          denim_est: p.denimKnown ? r2(p.denim) : null,
          denim_units_est: p.denimKnown ? r2(p.denimUnits) : null,
          itpos_extra: p.extraKnown ? r2(p.extra) : null,
        }))
        .sort((a, b) => b.net_ciro - a.net_ciro),
    });
  }
  return out;
}
