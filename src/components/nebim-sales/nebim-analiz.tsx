"use client";

import { Loader2, Percent, Tag } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import type { NebimSalesSelection } from "./nebim-filters";

const TRY = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (n: number | null | undefined) => `₺${TRY.format(n ?? 0)}`;

function toInput(f: NebimSalesSelection) {
  return {
    store_id: f.storeId || undefined,
    date_from: f.dateFrom || undefined,
    date_to: f.dateTo || undefined,
    only_returns: f.onlyReturns || undefined,
  };
}

export function NebimAnaliz({ filters }: { filters: NebimSalesSelection }) {
  const input = toInput(filters);
  const { data, isLoading } = trpc.nebimSales.analiz.useQuery(input);

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
          Analiz hesaplanıyor…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI */}
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Net Toplam" value={fmt(data.kpi.net_total)} />
        <Kpi label="Fiş Sayısı" value={String(data.kpi.invoices)} />
        <Kpi label="Satır Sayısı" value={String(data.kpi.lines)} />
      </div>

      {/* İndirim Analizi — orijinal fiyat → satılan fiyat → indirim % */}
      <IndirimAnaliz indirim={data.indirim} />
    </div>
  );
}

function IndirimAnaliz({
  indirim,
}: {
  indirim: {
    orijinal_total: number;
    net_total: number;
    indirim_total: number;
    avg_pct: number;
    lines: number;
    discounted_lines: number;
    buckets: Array<{ key: string; label: string; lines: number; orijinal: number }>;
  };
}) {
  const pctStr = `%${TRY.format(indirim.avg_pct)}`;
  const oran =
    indirim.lines > 0 ? (indirim.discounted_lines / indirim.lines) * 100 : 0;
  const maxLines = Math.max(1, ...indirim.buckets.map((b) => b.lines));

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
            <Percent className="h-4 w-4" />
          </div>
          <span className="font-semibold text-sm">İndirim Analizi</span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            sadece satış (iade hariç)
          </span>
        </div>

        {/* Orijinal → Net → İndirim */}
        <div className="grid grid-cols-3 divide-x divide-border/40 border-b border-border/40">
          <Stat label="Orijinal Tutar" value={fmt(indirim.orijinal_total)} sub="iskonto öncesi" />
          <Stat label="Net Satış" value={fmt(indirim.net_total)} sub="iskonto sonrası" />
          <Stat
            label="İndirim"
            value={fmt(indirim.indirim_total)}
            sub={`ortalama ${pctStr}`}
            accent
          />
        </div>

        {/* indirimli satır oranı */}
        <div className="px-4 py-2.5 text-[11px] text-muted-foreground flex items-center gap-1.5 border-b border-border/40">
          <Tag className="h-3 w-3 text-amber-500" />
          <span>
            <span className="font-semibold text-foreground tabular-nums">
              {indirim.discounted_lines}
            </span>{" "}
            / {indirim.lines} satır indirimli
            <span className="text-muted-foreground"> (%{TRY.format(oran)})</span>
          </span>
        </div>

        {/* Dağılım */}
        <div className="px-4 py-3 space-y-2">
          {indirim.buckets.map((b) => {
            const share =
              indirim.lines > 0 ? (b.lines / indirim.lines) * 100 : 0;
            const width = (b.lines / maxLines) * 100;
            const isZero = b.key === "b0";
            return (
              <div key={b.key} className="flex items-center gap-3">
                <span className="w-20 text-[11px] tabular-nums text-muted-foreground shrink-0">
                  {b.label}
                </span>
                <div className="flex-1 h-4 rounded bg-muted/50 overflow-hidden">
                  <div
                    className={`h-full rounded ${isZero ? "bg-slate-300" : "bg-amber-500"}`}
                    style={{ width: `${width}%` }}
                  />
                </div>
                <span className="w-24 text-right text-[11px] tabular-nums shrink-0">
                  <span className="font-semibold">{b.lines}</span>
                  <span className="text-muted-foreground"> ·%{TRY.format(share)}</span>
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold tabular-nums mt-0.5 ${accent ? "text-amber-600" : ""}`}>
        {value}
      </div>
      {sub ? <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div> : null}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-xl font-bold tabular-nums mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
