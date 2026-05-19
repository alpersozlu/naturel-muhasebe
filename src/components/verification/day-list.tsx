"use client";

import { CalendarDays } from "lucide-react";
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
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <CalendarDays className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div>Bu ay için kayıt yok.</div>
          <div className="text-xs mt-1">
            Bir gün için belge yüklediğinde burada görünür.
          </div>
        </CardContent>
      </Card>
    );
  }

  const refresh = () =>
    utils.verification.listForMonth.invalidate({
      store_id: storeId,
      year,
      month,
    });

  return (
    <div className="space-y-2">
      {data.map((r) => (
        <DayRow
          key={r.id}
          record={r}
          onChange={refresh}
          canUnlock={canUnlock}
        />
      ))}
    </div>
  );
}
