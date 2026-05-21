"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Check } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { ChartSkeleton } from "@/components/shared/skeleton";
import { useCountUp } from "@/lib/use-count-up";

const TRY = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (n: number) => TRY.format(n);

type DayVariance = {
  date: string;
  difference: number;
  notes: string | null;
  locked: boolean;
  within_tolerance: boolean;
};

type Store = {
  store_id: string;
  store_name: string;
  brand_name: string;
  net_diff: number;
  total_deficit: number;
  total_surplus: number;
  days_with_variance: number;
  days: DayVariance[];
};

export function CashVarianceBlock({
  brandId,
  storeId,
  year,
  month,
}: {
  brandId: string;
  storeId: string;
  year: number;
  month: number;
}) {
  const { data, isLoading } = trpc.analytics.cashVariance.useQuery({
    brand_id: brandId || undefined,
    store_id: storeId || undefined,
    year,
    month,
  });

  if (isLoading) {
    return <ChartSkeleton height={400} />;
  }
  if (!data) return null;

  const problemStores = data.by_store.filter(
    (s) => s.days_with_variance > 0 || s.total_deficit > 0 || s.total_surplus > 0
  );
  const cleanStores = data.by_store.filter(
    (s) => s.days_with_variance === 0 && s.total_deficit === 0 && s.total_surplus === 0
  );

  const net = data.net;
  const isOverallDeficit = net < -0.5;
  const isOverallSurplus = net > 0.5;
  const heroTone = isOverallDeficit
    ? "text-rose-700"
    : isOverallSurplus
      ? "text-amber-700"
      : "text-emerald-700";
  const heroSubLabel = isOverallDeficit
    ? "eksik"
    : isOverallSurplus
      ? "fazla"
      : "tolerans içinde";

  // Bar normalizasyonu — en büyük mutlak fark
  const maxAbs = Math.max(
    ...problemStores.map((s) => Math.abs(s.net_diff)),
    1
  );

  return (
    <>
      {/* Hero — tek büyük rakam */}
      <Card className="mb-4 overflow-hidden animate-fade-in">
        <CardContent className="px-6 py-10 lg:py-14 text-center">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            {data.period_label || "Cari Ay"} · Kasa Farkı
          </div>
          <HeroNumber net={net} tone={heroTone} />
          <div className="text-sm text-muted-foreground mt-1">{heroSubLabel}</div>
          <div className="mt-5 text-sm text-muted-foreground">
            {problemStores.length > 0 ? (
              <span>
                <span className="text-foreground font-medium">
                  {data.stores_with_deficit} mağazada eksik
                </span>
                {problemStores.length > data.stores_with_deficit ? (
                  <span>
                    {" "}·{" "}
                    {problemStores.length - data.stores_with_deficit} mağazada
                    fazla
                  </span>
                ) : null}
                {cleanStores.length > 0 ? (
                  <span> · {cleanStores.length} mağaza tolerans içinde</span>
                ) : null}
              </span>
            ) : data.stores_count > 0 ? (
              <span>{data.stores_count} mağaza · hepsi tolerans içinde ✓</span>
            ) : (
              <span>Bu kapsamda mağaza yok</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Problem stores — büyükten küçüğe */}
      {problemStores.length > 0 ? (
        <div className="space-y-2 mb-4">
          {problemStores.map((s) => (
            <StoreCardApple key={s.store_id} store={s} maxAbs={maxAbs} />
          ))}
        </div>
      ) : null}

      {/* Clean stores — collapsed disclosure */}
      {cleanStores.length > 0 ? (
        <CleanDisclosure stores={cleanStores} />
      ) : null}
    </>
  );
}

function HeroNumber({ net, tone }: { net: number; tone: string }) {
  const animated = useCountUp(net, 900);
  return (
    <div
      className={`mt-3 text-5xl lg:text-6xl font-semibold tabular-nums tracking-tight ${tone}`}
    >
      {animated >= 0 ? "+" : ""}
      {fmt(animated)}
      <span className="text-2xl font-normal text-muted-foreground ml-2">₺</span>
    </div>
  );
}

function StoreCardApple({
  store,
  maxAbs,
}: {
  store: Store;
  maxAbs: number;
}) {
  const [open, setOpen] = useState(false);
  const isDeficit = store.net_diff < -0.5;
  const isSurplus = store.net_diff > 0.5;
  const widthPct = (Math.abs(store.net_diff) / maxAbs) * 100;
  const barColor = isDeficit ? "#E11D48" : isSurplus ? "#F59E0B" : "#10B981";
  const numberTone = isDeficit
    ? "text-rose-700"
    : isSurplus
      ? "text-amber-700"
      : "text-emerald-700";

  return (
    <Card className="animate-fade-in overflow-hidden">
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full text-left px-5 py-4 hover:bg-muted/30 transition-colors flex items-start gap-4"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 mt-1 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 mt-1 text-muted-foreground shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-foreground">
                  {store.store_name}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {store.brand_name}
                </span>
              </div>
              <div className={`text-lg font-semibold tabular-nums ${numberTone}`}>
                {store.net_diff >= 0 ? "+" : ""}
                {fmt(store.net_diff)}
                <span className="text-xs font-normal text-muted-foreground ml-1">
                  ₺
                </span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-1 tabular-nums">
              {store.days_with_variance > 0
                ? `${store.days_with_variance} sorunlu gün`
                : "tolerans içinde"}
              {store.days.length > 0 ? ` · ${store.days.length} gün kayıt` : ""}
            </div>
            {/* Proporsiyonel bar */}
            <div className="mt-2.5 h-1.5 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${widthPct}%`, backgroundColor: barColor }}
              />
            </div>
          </div>
        </button>

        {open && store.days.length > 0 ? (
          <DayDetails days={store.days} />
        ) : open && store.days.length === 0 ? (
          <div className="px-5 pb-5 text-xs text-muted-foreground italic">
            Bu ay için kayıt yok.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DayDetails({ days }: { days: DayVariance[] }) {
  const sorted = [...days].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="border-t border-border/60 bg-muted/15">
      <div className="px-5 py-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
          Günlük Kasa Farkları
        </div>
        <div className="divide-y divide-border/40">
          {sorted.map((d) => (
            <DayRow key={d.date} day={d} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DayRow({ day }: { day: DayVariance }) {
  const isDeficit = day.difference < -0.5 && !day.within_tolerance;
  const isSurplus = day.difference > 0.5 && !day.within_tolerance;
  const tone = isDeficit
    ? "text-rose-700"
    : isSurplus
      ? "text-amber-700"
      : "text-muted-foreground";
  const sign = day.difference >= 0 ? "+" : "";
  const formatted = new Date(day.date).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
  });
  return (
    <div className="py-2 grid grid-cols-12 gap-3 items-baseline text-sm">
      <div className="col-span-3 sm:col-span-2 text-muted-foreground tabular-nums">
        {formatted}
      </div>
      <div className={`col-span-3 sm:col-span-2 tabular-nums font-medium ${tone}`}>
        {day.within_tolerance ? (
          <span className="text-emerald-600 inline-flex items-center gap-1">
            <Check className="h-3 w-3" />
            <span>
              {sign}
              {fmt(day.difference)} ₺
            </span>
          </span>
        ) : (
          <span>
            {sign}
            {fmt(day.difference)} ₺
          </span>
        )}
      </div>
      <div className="col-span-6 sm:col-span-7 text-xs text-muted-foreground italic truncate">
        {day.notes ? `"${day.notes}"` : <span className="opacity-50">—</span>}
      </div>
      <div className="col-span-12 sm:col-span-1 text-right">
        <span
          className={`text-[10px] uppercase tracking-wider ${
            day.locked ? "text-slate-500" : "text-muted-foreground"
          }`}
        >
          {day.locked ? "Kilitli" : "Açık"}
        </span>
      </div>
    </div>
  );
}

function CleanDisclosure({ stores }: { stores: Store[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="animate-fade-in">
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full text-left px-5 py-4 hover:bg-muted/30 transition-colors flex items-center gap-3"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <Check className="h-4 w-4 text-emerald-600 shrink-0" />
          <span className="text-sm font-medium text-foreground flex-1">
            {stores.length} mağaza tolerans içinde
          </span>
          <span className="text-xs text-muted-foreground">göster</span>
        </button>

        {open ? (
          <div className="border-t border-border/60 divide-y divide-border/40">
            {stores.map((s) => (
              <CleanStoreRow key={s.store_id} store={s} />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CleanStoreRow({ store }: { store: Store }) {
  const [open, setOpen] = useState(false);
  const hasDays = store.days.length > 0;
  return (
    <div>
      <button
        type="button"
        onClick={() => hasDays && setOpen(!open)}
        disabled={!hasDays}
        className={`w-full text-left px-5 py-3 flex items-center gap-3 ${
          hasDays ? "hover:bg-muted/20 cursor-pointer" : "cursor-default"
        }`}
      >
        {hasDays ? (
          open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )
        ) : (
          <div className="w-3.5 shrink-0" />
        )}
        <span className="text-sm text-foreground">{store.store_name}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {store.brand_name}
        </span>
        <span className="flex-1"></span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {hasDays
            ? `${store.days.length} gün · ${store.net_diff >= 0 ? "+" : ""}${fmt(store.net_diff)} ₺`
            : "kayıt yok"}
        </span>
      </button>
      {open && hasDays ? <DayDetails days={store.days} /> : null}
    </div>
  );
}
