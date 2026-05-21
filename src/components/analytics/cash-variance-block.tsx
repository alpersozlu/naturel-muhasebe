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
const fmtShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
};

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

const DEFICIT_COLOR = "#E11D48"; // rose-600
const SURPLUS_COLOR = "#F59E0B"; // amber-500
const CLEAN_COLOR = "#10B981"; // emerald-500

function toneFor(net: number): {
  text: string;
  bar: string;
  label: "EKSİK" | "FAZLA" | "TEMİZ";
} {
  if (net < -0.5) return { text: "text-rose-700", bar: DEFICIT_COLOR, label: "EKSİK" };
  if (net > 0.5) return { text: "text-amber-700", bar: SURPLUS_COLOR, label: "FAZLA" };
  return { text: "text-emerald-700", bar: CLEAN_COLOR, label: "TEMİZ" };
}

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
    return <ChartSkeleton height={500} />;
  }
  if (!data) return null;

  const net = data.net;
  const heroTone = toneFor(net).text;
  const heroSubLabel = net < -0.5 ? "eksik" : net > 0.5 ? "fazla" : "tolerans içinde";

  // Bar chart için — en yüksek mutlak fark
  const maxAbs = Math.max(...data.by_store.map((s) => Math.abs(s.net_diff)), 1);

  // Sıralama: en yüksek mutlak farktan en düşüğe (sorunlular önde)
  const sortedStores = [...data.by_store].sort(
    (a, b) => Math.abs(b.net_diff) - Math.abs(a.net_diff)
  );

  const stats = {
    deficit: data.stores_with_deficit,
    surplus: data.by_store.filter((s) => s.net_diff > 0.5).length,
    clean: data.by_store.filter((s) => Math.abs(s.net_diff) <= 0.5).length,
  };

  return (
    <>
      {/* Hero — 2 sütun: rakam + bar chart */}
      <Card className="mb-4 overflow-hidden animate-fade-in">
        <CardContent className="p-0">
          <div className="grid grid-cols-1 lg:grid-cols-5">
            <div className="lg:col-span-2 px-6 py-8 lg:py-12 text-center lg:text-left flex flex-col justify-center">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                {data.period_label || "Cari Ay"} · Kasa Farkı
              </div>
              <HeroNumber net={net} tone={heroTone} />
              <div className="text-sm text-muted-foreground mt-1">
                {heroSubLabel}
              </div>
              <div className="mt-4 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 justify-center lg:justify-start">
                {stats.deficit > 0 ? (
                  <span>
                    <span className="text-rose-700 font-medium">
                      {stats.deficit}
                    </span>{" "}
                    eksik
                  </span>
                ) : null}
                {stats.surplus > 0 ? (
                  <span>
                    <span className="text-amber-700 font-medium">
                      {stats.surplus}
                    </span>{" "}
                    fazla
                  </span>
                ) : null}
                {stats.clean > 0 ? (
                  <span>
                    <span className="text-emerald-700 font-medium">
                      {stats.clean}
                    </span>{" "}
                    tolerans içinde
                  </span>
                ) : null}
              </div>
            </div>

            {/* Bar chart — sağ tarafta */}
            <div className="lg:col-span-3 border-t lg:border-t-0 lg:border-l border-border/60 bg-muted/10 px-5 py-6 lg:py-8">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">
                Mağaza Bazında
              </div>
              <div className="space-y-2.5">
                {sortedStores.map((s) => (
                  <BarRow key={s.store_id} store={s} maxAbs={maxAbs} />
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tüm 7 mağaza — eşit boyutlu kartlar */}
      <div className="space-y-2">
        {sortedStores.map((s) => (
          <StoreCardApple key={s.store_id} store={s} maxAbs={maxAbs} />
        ))}
      </div>
    </>
  );
}

function HeroNumber({ net, tone }: { net: number; tone: string }) {
  const animated = useCountUp(net, 900);
  return (
    <div
      className={`mt-3 text-4xl lg:text-5xl font-semibold tabular-nums tracking-tight ${tone}`}
    >
      {animated >= 0 ? "+" : ""}
      {fmt(animated)}
      <span className="text-xl font-normal text-muted-foreground ml-2">₺</span>
    </div>
  );
}

function BarRow({ store, maxAbs }: { store: Store; maxAbs: number }) {
  const t = toneFor(store.net_diff);
  const abs = Math.abs(store.net_diff);
  const widthPct = abs > 0.5 ? Math.max(1.5, (abs / maxAbs) * 100) : 0;
  return (
    <div className="grid grid-cols-12 gap-3 items-center text-xs">
      <div className="col-span-4 truncate text-foreground">{store.store_name}</div>
      <div className="col-span-5 h-2 rounded-full bg-muted/40 overflow-hidden">
        {widthPct > 0 ? (
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${widthPct}%`, backgroundColor: t.bar }}
          />
        ) : null}
      </div>
      <div className={`col-span-3 text-right tabular-nums font-medium ${t.text}`}>
        {abs > 0.5 ? (
          <>
            {store.net_diff > 0 ? "+" : ""}
            {fmtShort(store.net_diff)}
            <span className="text-muted-foreground font-normal ml-0.5">₺</span>
          </>
        ) : (
          <span className="text-muted-foreground font-normal">0 ₺</span>
        )}
      </div>
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
  const t = toneFor(store.net_diff);
  const abs = Math.abs(store.net_diff);
  const widthPct = abs > 0.5 ? Math.max(1, (abs / maxAbs) * 100) : 0;
  const hasData = store.days.length > 0;

  return (
    <Card className="animate-fade-in overflow-hidden">
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => hasData && setOpen(!open)}
          disabled={!hasData}
          className={`w-full text-left px-5 py-4 transition-colors flex items-start gap-4 ${
            hasData ? "hover:bg-muted/30 cursor-pointer" : "cursor-default"
          }`}
        >
          {hasData ? (
            open ? (
              <ChevronDown className="h-4 w-4 mt-1 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 mt-1 text-muted-foreground shrink-0" />
            )
          ) : (
            <div className="w-4 shrink-0" />
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
              <div className={`text-lg font-semibold tabular-nums ${t.text}`}>
                {abs > 0.5 ? (
                  <>
                    {store.net_diff > 0 ? "+" : ""}
                    {fmt(store.net_diff)}
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      ₺
                    </span>
                  </>
                ) : (
                  <span className="text-emerald-600 inline-flex items-center gap-1 text-base font-medium">
                    <Check className="h-4 w-4" />
                    Temiz
                  </span>
                )}
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-1 tabular-nums">
              {store.days_with_variance > 0 ? (
                <>
                  {store.days_with_variance} sorunlu gün · {store.days.length} gün kayıt
                </>
              ) : hasData ? (
                <>tolerans içinde · {store.days.length} gün kayıt</>
              ) : (
                <>bu ay için kayıt yok</>
              )}
            </div>
            {/* Proporsiyonel bar */}
            <div className="mt-2.5 h-1.5 rounded-full bg-muted/40 overflow-hidden">
              {widthPct > 0 ? (
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${widthPct}%`, backgroundColor: t.bar }}
                />
              ) : null}
            </div>
          </div>
        </button>

        {open && hasData ? <DayDetails days={store.days} /> : null}
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
