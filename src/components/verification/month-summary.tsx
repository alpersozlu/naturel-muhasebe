"use client";

import { AlertOctagon, Gauge, LayoutGrid } from "lucide-react";
import { fmt } from "./types";
import { STATUS_META, STATUS_ORDER, type DayStatusKey } from "./status";

export type ListFilter = "all" | "attention" | "optimum" | DayStatusKey;

export type MonthCounts = {
  byStatus: Record<DayStatusKey, number>;
  attention: number;
  optimumLow: number;
  /** Bugüne kadar geçen gün sayısı (gelecek günler hariç). */
  elapsed: number;
  salesTotal: number;
  summaryDays: number;
};

/**
 * Ay özeti şeridi: kapanış ilerlemesi + durum karoları. Karolar süzgeçtir —
 * tıklayınca liste o duruma iner (aria-pressed). Renk tek başına anlam
 * taşımaz; her karo ikon + etiket + sayı.
 */
export function MonthSummary({
  counts,
  filter,
  onFilter,
}: {
  counts: MonthCounts;
  filter: ListFilter;
  onFilter: (f: ListFilter) => void;
}) {
  const locked = counts.byStatus.locked;
  const pct = counts.elapsed > 0 ? Math.round((locked / counts.elapsed) * 100) : 0;

  return (
    <section aria-label="Ay özeti" className="mb-4 rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm font-semibold">Ay kapanışı</div>
            <div className="text-xs tabular-nums text-muted-foreground">
              <span className="font-semibold text-foreground">{locked}</span> / {counts.elapsed} gün kilitli · %{pct}
            </div>
          </div>
          <div
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={counts.elapsed}
            aria-valuenow={locked}
            aria-label="Kilitli gün oranı"
          >
            <div className="h-full rounded-full bg-emerald-500 motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="shrink-0 sm:text-right">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Özet satış toplamı</div>
          <div className="text-base font-semibold tabular-nums">{fmt(counts.salesTotal)} ₺</div>
          <div className="text-[11px] text-muted-foreground">{counts.summaryDays} günün özeti</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border/70 px-3 py-2.5" role="group" aria-label="Duruma göre süz">
        <Tile active={filter === "all"} onClick={() => onFilter("all")} Icon={LayoutGrid} label="Tümü" count={counts.elapsed} tone="neutral" />
        <Tile
          active={filter === "attention"}
          onClick={() => onFilter("attention")}
          Icon={AlertOctagon}
          label="Dikkat gereken"
          count={counts.attention}
          tone={counts.attention > 0 ? "rose" : "neutral"}
        />
        {STATUS_ORDER.map((k) => {
          const m = STATUS_META[k];
          return (
            <Tile key={k} active={filter === k} onClick={() => onFilter(k)} Icon={m.Icon} label={m.label} count={counts.byStatus[k]} dot={m.dot} tone="neutral" />
          );
        })}
        <Tile
          active={filter === "optimum"}
          onClick={() => onFilter("optimum")}
          Icon={Gauge}
          label="Optimum düşük"
          count={counts.optimumLow}
          tone={counts.optimumLow > 0 ? "amber" : "neutral"}
        />
      </div>
    </section>
  );
}

function Tile({
  active,
  onClick,
  Icon,
  label,
  count,
  dot,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  dot?: string;
  tone: "neutral" | "rose" | "amber";
}) {
  const toneText = tone === "rose" ? "text-rose-700" : tone === "amber" ? "text-amber-700" : "text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
        active ? "border-slate-900 bg-slate-900 text-white" : "border-border bg-white hover:bg-muted/60"
      }`}
    >
      {dot ? <span aria-hidden className={`h-2 w-2 rounded-full ${active ? "bg-white/80" : dot}`} /> : <Icon className={`h-3.5 w-3.5 ${active ? "text-white" : "text-muted-foreground"}`} />}
      <span className={`text-xs ${active ? "text-white/90" : "text-muted-foreground"}`}>{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${active ? "text-white" : toneText}`}>{count}</span>
    </button>
  );
}
