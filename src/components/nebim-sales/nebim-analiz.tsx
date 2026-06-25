"use client";

import { Loader2, Percent, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import type { NebimSalesSelection } from "./nebim-filters";

const TRY = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (n: number | null | undefined) => `₺${TRY.format(n ?? 0)}`;
const INT = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const intTL = (n: number) => `₺${INT.format(Math.round(n))}`;
const num2 = (n: number) => n.toFixed(2);
const pct1 = (n: number) => `%${n.toFixed(1)}`;

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
  const staff = trpc.nebimSales.staffKpi.useQuery(input);

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

      {/* Çalışan Satış KPI */}
      {staff.data && staff.data.rows.length > 0 ? (
        <CalisanKpi data={staff.data} />
      ) : null}
    </div>
  );
}

function CalisanKpi({
  data,
}: {
  data: {
    total: {
      net: number;
      invoices: number;
      units: number;
      upt: number;
      sepet: number;
      tekil_pct: number;
    };
    rows: Array<{
      name: string;
      net: number;
      net_pct: number;
      invoices: number;
      units: number;
      upt: number;
      sepet: number;
      tekil_pct: number;
    }>;
  };
}) {
  const tekilCls = (p: number) =>
    p < 50 ? "text-emerald-600" : p >= 58 ? "text-rose-600" : "text-amber-600";
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Users className="h-4 w-4" />
          </div>
          <span className="font-semibold text-sm">Çalışan Satış KPI</span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            iade hariç (brüt) · NET TL&apos;ye göre sıralı
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-100 text-[10px] uppercase tracking-wider">
                <th className="text-left font-semibold px-3 py-2.5">Çalışan</th>
                <th className="text-right font-semibold px-3 py-2.5">Net %</th>
                <th className="text-right font-semibold px-3 py-2.5">Net TL</th>
                <th className="text-right font-semibold px-3 py-2.5">UPT</th>
                <th className="text-right font-semibold px-3 py-2.5">Sepet TL</th>
                <th className="text-right font-semibold px-3 py-2.5">Tekil İşlem %</th>
                <th className="text-right font-semibold px-3 py-2.5 pr-4">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.name} className="border-b border-border/40 hover:bg-muted/30">
                  <td className="px-3 py-2.5 font-medium">{r.name}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {pct1(r.net_pct)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                    {intTL(r.net)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num2(r.upt)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{intTL(r.sepet)}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${tekilCls(r.tekil_pct)}`}>
                    {pct1(r.tekil_pct)}
                  </td>
                  <td className="px-3 py-2.5 pr-4 text-right tabular-nums">{r.invoices}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-900 text-slate-100 font-semibold">
                <td className="px-3 py-2.5">Genel Toplam</td>
                <td className="px-3 py-2.5 text-right tabular-nums">%100,0</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{intTL(data.total.net)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{num2(data.total.upt)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{intTL(data.total.sepet)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{pct1(data.total.tekil_pct)}</td>
                <td className="px-3 py-2.5 pr-4 text-right tabular-nums">{data.total.invoices}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
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
