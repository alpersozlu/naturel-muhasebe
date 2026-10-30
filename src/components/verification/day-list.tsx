"use client";

import { useMemo, useState } from "react";
import { Store, SearchX } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/shared/skeleton";
import { DayRow, type DayEntry } from "./day-row";
import { MonthSummary, type ListFilter, type MonthCounts } from "./month-summary";
import { deriveFlags, deriveStatus, type DayStatusKey } from "./status";
import { num, type DayRecord } from "./types";

/**
 * Doğrulama Sistemi gövdesi: tek sorgu (verification.listForMonth) hem ay
 * özetini hem gün listesini besler. Ayın her günü görünür: dolu gün kartı,
 * boş geçmiş gün, gelecek gün. Birleşik günler ilk günde tek kart.
 */
export function DayList({
  storeId,
  year,
  month,
  canUnlock,
}: {
  storeId: string;
  year: number;
  month: number;
  canUnlock: boolean;
}) {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<ListFilter>("all");
  const { data, isLoading } = trpc.verification.listForMonth.useQuery(
    { store_id: storeId, year, month },
    { enabled: !!storeId }
  );

  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const isFutureMonth = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1);
  const todayDay = isCurrentMonth ? now.getDate() : null;

  const { entries, counts } = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const rows = (data ?? []) as DayRecord[];
    const byDay = new Map<number, DayRecord>();
    for (const r of rows) byDay.set(new Date(r.date).getUTCDate(), r);
    const groups = new Map<string, DayRecord[]>();
    for (const r of rows) {
      if (r.merge_group_id) (groups.get(r.merge_group_id) ?? groups.set(r.merge_group_id, []).get(r.merge_group_id)!).push(r);
    }
    for (const g of Array.from(groups.values())) g.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const list: DayEntry[] = [];
    const byStatus: Record<DayStatusKey, number> = { locked: 0, match: 0, mismatch: 0, pending: 0, empty: 0, future: 0 };
    let attention = 0;
    let optimumLow = 0;
    let salesTotal = 0;
    let summaryDays = 0;
    let elapsed = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const record = byDay.get(day);
      const isFuture = isFutureMonth || (todayDay !== null && day > todayDay);
      if (!record) {
        const kind = isFuture ? "future" : "empty";
        list.push({ kind, day });
        byStatus[kind] += 1;
        if (!isFuture) elapsed += 1;
        continue;
      }
      const group = record.merge_group_id ? groups.get(record.merge_group_id) : undefined;
      if (group && group.length > 1 && group[0] !== record) continue; // grubun ilk gününe katlandı
      const days = group && group.length > 1 ? group : [record];
      const lead = days.find((r) => !!r.store_summary) ?? days[days.length - 1]!;
      const status = deriveStatus(days);
      const flags = deriveFlags(lead, status);
      list.push({ kind: "filled", day, lead, days, status, flags });
      byStatus[status] += 1;
      elapsed += days.length;
      if (flags.optimumLow) optimumLow += 1;
      if (status === "mismatch" || status === "pending" || flags.optimumLow || flags.sapIssue) attention += 1;
      if (lead.store_summary) {
        salesTotal += num(lead.store_summary.sales_total_try);
        summaryDays += 1;
      }
    }
    // Art arda boş geçmiş günler (bugün hariç) tek "gap" satırında: 1–13 Ekim gibi
    // uzun boşluklar listeyi doldurmasın.
    const folded: DayEntry[] = [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i]!;
      if (e.kind === "empty" && e.day !== todayDay) {
        let j = i;
        while (j + 1 < list.length && list[j + 1]!.kind === "empty" && list[j + 1]!.day !== todayDay) j++;
        if (j > i) {
          folded.push({ kind: "gap", day: e.day, to: list[j]!.day, count: j - i + 1 });
          i = j;
          continue;
        }
      }
      folded.push(e);
    }
    const counts: MonthCounts = { byStatus, attention, optimumLow, elapsed, salesTotal, summaryDays };
    return { entries: folded, counts };
  }, [data, year, month, isFutureMonth, todayDay]);

  if (!storeId) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-14 text-center">
        <Store className="mb-3 h-8 w-8 text-muted-foreground/60" aria-hidden />
        <div className="text-sm font-medium">Mağaza seçilmedi</div>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">Yukarıdan marka ve mağaza seçince ayın gün gün doğrulama durumu burada listelenir.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Yükleniyor">
        <Skeleton className="h-24 w-full rounded-2xl" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const refresh = () => utils.verification.listForMonth.invalidate({ store_id: storeId, year, month });

  const visible = entries.filter((e) => {
    if (filter === "all") return true;
    if (e.kind === "gap") return filter === "empty";
    if (e.kind !== "filled") return filter === e.kind;
    if (filter === "attention") return e.status === "mismatch" || e.status === "pending" || e.flags.optimumLow || !!e.flags.sapIssue;
    if (filter === "optimum") return e.flags.optimumLow;
    return e.status === filter;
  });

  return (
    <>
      <MonthSummary counts={counts} filter={filter} onFilter={setFilter} />
      <ColumnHeader />
      {visible.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <SearchX className="mb-2 h-6 w-6 text-muted-foreground/60" aria-hidden />
          <div className="text-sm font-medium">Bu süzgeçte gün yok</div>
          <button type="button" onClick={() => setFilter("all")} className="mt-2 text-xs text-primary underline-offset-2 hover:underline">
            Tüm günleri göster
          </button>
        </div>
      ) : (
        <div className="space-y-1.5" role="list" aria-label="Günler">
          {visible.map((e) => (
            <div key={e.day} role="listitem">
              <DayRow entry={e} year={year} month={month} isToday={todayDay === e.day} onChange={refresh} canUnlock={canUnlock} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ColumnHeader() {
  return (
    <div className="sticky top-0 z-10 mb-1.5 hidden grid-cols-12 gap-3 rounded-lg bg-background/95 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur sm:grid">
      <div className="col-span-1">Gün</div>
      <div className="col-span-2">Mağaza özeti</div>
      <div className="col-span-4">Belgeler</div>
      <div className="col-span-2 text-right">Kasa farkı</div>
      <div className="col-span-3 text-right">Durum</div>
    </div>
  );
}
