"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Banknote,
  Check,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { ChartSkeleton } from "@/components/shared/skeleton";

const TRY = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (n: number) => TRY.format(n);
const fmtShort = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
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
    return <ChartSkeleton height={300} />;
  }
  if (!data) return null;

  const hasAnyVariance =
    data.total_deficit > 0 || data.total_surplus > 0;

  return (
    <Card className="animate-fade-in mb-6">
      <CardContent className="p-5 lg:p-6">
        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div>
            <div className="font-semibold flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-rose-600" />
              Kasa Farkı Takibi — {data.period_label}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Mağaza özetindeki satışla yüklenen belgelerin toplamı arasındaki
              fark · {data.stores_count} mağaza ·{" "}
              {data.stores_with_deficit > 0 ? (
                <span className="text-rose-600 font-medium">
                  {data.stores_with_deficit} mağazada eksik
                </span>
              ) : (
                <span className="text-emerald-700 font-medium">
                  hiçbir mağazada eksik yok
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Hero KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <KpiTile
            icon={TrendingDown}
            label="Toplam Eksik"
            value={`-${fmtShort(data.total_deficit)}`}
            unit="₺"
            tone={data.total_deficit > 0 ? "rose" : "muted"}
          />
          <KpiTile
            icon={TrendingUp}
            label="Toplam Fazla"
            value={`+${fmtShort(data.total_surplus)}`}
            unit="₺"
            tone={data.total_surplus > 0 ? "amber" : "muted"}
          />
          <KpiTile
            icon={Banknote}
            label="Net Sapma"
            value={`${data.net >= 0 ? "+" : ""}${fmtShort(data.net)}`}
            unit="₺"
            tone={data.net < 0 ? "rose" : data.net > 0 ? "amber" : "emerald"}
          />
          <KpiTile
            icon={AlertTriangle}
            label="Sorunlu Mağaza"
            value={`${data.stores_with_deficit}`}
            unit={`/ ${data.stores_count}`}
            tone={data.stores_with_deficit > 0 ? "rose" : "emerald"}
          />
        </div>

        {/* Store rows */}
        {!hasAnyVariance && data.stores_count > 0 ? (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-900 flex items-center gap-2">
            <Check className="h-4 w-4" />
            Bu ay hiçbir mağazada tolerans dışı fark yok. Tüm günler temiz.
          </div>
        ) : data.by_store.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            Bu kapsamda mağaza bulunamadı.
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            {data.by_store.map((s, i) => (
              <StoreRow key={s.store_id} store={s} defaultOpen={i === 0 && s.total_deficit > 0} />
            ))}
          </div>
        )}

        {data.total_deficit > 0 ? (
          <div className="mt-4 text-xs text-muted-foreground leading-relaxed">
            <strong className="text-rose-700">Eksik (negatif fark):</strong>{" "}
            mağaza özetindeki satışın belgelerden fazla olması — belgelerde
            görmediğimiz satış var demek. Potansiyel kayıp veya hırsızlık
            sinyali olabilir.{" "}
            <strong className="text-amber-700">Fazla (pozitif fark):</strong>{" "}
            belgelerin özetten yüksek olması — müşteriden fazla nakit alınmış,
            üst kalmış vb. olabilir.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  unit,
  tone,
}: {
  icon: typeof AlertTriangle;
  label: string;
  value: string;
  unit: string;
  tone: "rose" | "amber" | "emerald" | "muted";
}) {
  const toneClass = {
    rose: "bg-rose-50 text-rose-700 border-rose-200/70",
    amber: "bg-amber-50 text-amber-700 border-amber-200/70",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200/70",
    muted: "bg-muted/30 text-muted-foreground border-border/60",
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneClass}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] uppercase tracking-wider font-medium">
          {label}
        </span>
      </div>
      <div className="text-lg font-semibold tabular-nums tracking-tight">
        {value}
        <span className="text-xs font-normal opacity-70 ml-1">{unit}</span>
      </div>
    </div>
  );
}

function StoreRow({
  store,
  defaultOpen,
}: {
  store: {
    store_id: string;
    store_name: string;
    brand_name: string;
    net_diff: number;
    total_deficit: number;
    total_surplus: number;
    days_with_variance: number;
    days: Array<{ date: string; difference: number; notes: string | null; locked: boolean }>;
  };
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const hasIssue = store.total_deficit > 0 || store.total_surplus > 0;
  const isDeficit = store.total_deficit > store.total_surplus;
  const isSurplus = store.total_surplus > store.total_deficit;

  let StatusIcon = Check;
  let statusTone = "text-emerald-600";
  let statusLabel = "Temiz";
  if (isDeficit) {
    StatusIcon = AlertTriangle;
    statusTone = "text-rose-600";
    statusLabel = "EKSİK";
  } else if (isSurplus) {
    StatusIcon = TrendingUp;
    statusTone = "text-amber-600";
    statusLabel = "FAZLA";
  }

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => hasIssue && setOpen(!open)}
        disabled={!hasIssue}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
          hasIssue ? "hover:bg-muted/40 cursor-pointer" : "cursor-default"
        }`}
      >
        {hasIssue ? (
          open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )
        ) : (
          <div className="w-4 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`font-medium ${statusTone}`}>
              <StatusIcon className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
              {store.store_name}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {store.brand_name}
            </span>
          </div>
          {hasIssue ? (
            <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
              {store.days_with_variance} sorunlu gün
              {store.total_deficit > 0
                ? ` · brüt eksik ${fmt(store.total_deficit)} ₺`
                : ""}
              {store.total_surplus > 0
                ? ` · fazla ${fmt(store.total_surplus)} ₺`
                : ""}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground mt-0.5">
              tolerans içinde
            </div>
          )}
        </div>

        <div className="text-right tabular-nums shrink-0">
          <div
            className={`text-base font-bold ${
              store.net_diff < -0.5
                ? "text-rose-700"
                : store.net_diff > 0.5
                  ? "text-amber-700"
                  : "text-emerald-700"
            }`}
          >
            {store.net_diff >= 0 ? "+" : ""}
            {fmt(store.net_diff)} ₺
          </div>
          <div
            className={`text-[10px] uppercase tracking-wider font-semibold ${statusTone}`}
          >
            {statusLabel}
          </div>
        </div>
      </button>

      {/* Drill-down days */}
      {open && hasIssue && store.days.length > 0 ? (
        <div className="bg-muted/20 border-t border-border/60 px-4 py-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-medium py-1.5 px-2">Tarih</th>
                <th className="text-right font-medium py-1.5 px-2 w-32">Fark</th>
                <th className="text-left font-medium py-1.5 px-2">Not</th>
                <th className="text-right font-medium py-1.5 px-2 w-20">Durum</th>
              </tr>
            </thead>
            <tbody>
              {store.days.map((d) => (
                <tr key={d.date} className="border-t border-border/40">
                  <td className="py-1.5 px-2 tabular-nums">
                    {new Date(d.date).toLocaleDateString("tr-TR", {
                      day: "2-digit",
                      month: "short",
                    })}
                  </td>
                  <td
                    className={`py-1.5 px-2 text-right tabular-nums font-semibold ${
                      d.difference < 0 ? "text-rose-700" : "text-amber-700"
                    }`}
                  >
                    {d.difference >= 0 ? "+" : ""}
                    {fmt(d.difference)} ₺
                  </td>
                  <td className="py-1.5 px-2 text-xs text-muted-foreground italic">
                    {d.notes ? `"${d.notes}"` : <span className="opacity-60">— not yok</span>}
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <span
                      className={`text-[10px] uppercase tracking-wider font-medium ${
                        d.locked
                          ? "text-slate-600"
                          : "text-amber-700"
                      }`}
                    >
                      {d.locked ? "Kilitli" : "Açık"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
