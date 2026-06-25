"use client";

import { Loader2, Percent } from "lucide-react";
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
  };
}) {
  const pctStr = `%${TRY.format(indirim.avg_pct)}`;

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
        <div className="grid grid-cols-3 divide-x divide-border/40">
          <Stat label="Orijinal Tutar" value={fmt(indirim.orijinal_total)} sub="iskonto öncesi" />
          <Stat label="Net Satış" value={fmt(indirim.net_total)} sub="iskonto sonrası" />
          <Stat
            label="İndirim"
            value={fmt(indirim.indirim_total)}
            sub={`ortalama ${pctStr}`}
            accent
          />
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
