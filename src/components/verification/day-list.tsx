"use client";

import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { DayRow } from "./day-row";
import { Skeleton } from "@/components/shared/skeleton";

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
  const { data, isLoading } = trpc.verification.listForMonth.useQuery(
    { store_id: storeId, year, month },
    { enabled: !!storeId }
  );

  if (!storeId) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground text-sm">
          Önce marka ve mağaza seç.
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <>
        <ColumnHeader />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      </>
    );
  }

  const refresh = () =>
    utils.verification.listForMonth.invalidate({
      store_id: storeId,
      year,
      month,
    });

  // Pad with empty placeholders so every day of the month is visible.
  const daysInMonth = new Date(year, month, 0).getDate();
  type FilledRow = NonNullable<typeof data>[number];
  const byDay = new Map<number, FilledRow>();
  for (const r of data ?? []) {
    byDay.set(new Date(r.date).getUTCDate(), r);
  }

  return (
    <>
      <ColumnHeader />
      <div className="space-y-2">
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const record = byDay.get(day);
          if (record) {
            return (
              <DayRow
                key={`d-${day}`}
                record={record}
                onChange={refresh}
                canUnlock={canUnlock}
              />
            );
          }
          return (
            <DayRow
              key={`d-${day}`}
              emptyDay={{ day, year, month }}
            />
          );
        })}
      </div>
    </>
  );
}

function ColumnHeader() {
  return (
    <div className="hidden sm:grid grid-cols-12 gap-3 px-5 mb-2 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
      <div className="col-span-1">Gün</div>
      <div className="col-span-3">Mağaza Özeti Miktarı</div>
      <div className="col-span-5">Eşleştirme Belgeleri</div>
      <div className="col-span-3 text-right">Durum</div>
    </div>
  );
}
