"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import { Ticket, Store as StoreIcon, Calendar } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { ChartSkeleton } from "@/components/shared/skeleton";

const TRY = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const TRY2 = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmtShort = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${TRY.format(n / 1_000_000)}M`;
  if (Math.abs(n) >= 1_000) return `${TRY.format(n / 1_000)}K`;
  return TRY.format(n);
};

const STORE_COLORS = ["#2563EB", "#7C3AED", "#0891B2", "#DB2777", "#059669"];

export function MaviGiftVoucherBlock({
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
  const { data, isLoading } = trpc.analytics.maviGiftVoucher.useQuery({
    brand_id: brandId || undefined,
    store_id: storeId || undefined,
    year,
    month,
  });

  if (isLoading) {
    return <ChartSkeleton height={260} />;
  }

  // Hiç Derimod mağazası yoksa veya hiç veri yoksa gösterme
  if (!data || data.by_store.length === 0) {
    return null;
  }

  const hasAnyData =
    data.total > 0 || data.ytd_total > 0 || data.by_store.some((s) => s.year_total > 0);

  const maxMonthly = Math.max(...data.monthly_trend.map((m) => m.total), 1);

  return (
    <Card className="animate-fade-in border-blue-200/60">
      <CardContent className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div>
            <div className="font-semibold flex items-center gap-2">
              <Ticket className="h-4 w-4 text-blue-600" />
              Mavi Hediye Çeki (Derimod)
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Mavi'den gelen, Derimod'da kullanılan hediye çekleri — sadece
              istatistik, kasaya etkisi yok
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Pill
              label={data.period_label}
              value={fmtShort(data.total)}
              tone="blue"
            />
            <Pill label={`${year} YTD`} value={fmtShort(data.ytd_total)} tone="slate" />
          </div>
        </div>

        {!hasAnyData ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Bu dönemde Mavi hediye çeki kaydı yok.
          </div>
        ) : (
          <>
            {/* Mağaza bazında kartlar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
              {data.by_store.map((s, i) => (
                <div
                  key={s.store_id}
                  className="rounded-2xl border border-blue-200/50 bg-gradient-to-br from-blue-50/60 to-white p-4"
                >
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    <StoreIcon className="h-3.5 w-3.5" />
                    <span className="truncate">{s.store_name}</span>
                  </div>
                  <div
                    className="text-xl font-semibold tabular-nums"
                    style={{ color: STORE_COLORS[i % STORE_COLORS.length] }}
                  >
                    {TRY2.format(s.month_total)} ₺
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Yıl toplam: {TRY2.format(s.year_total)} ₺
                  </div>
                </div>
              ))}
            </div>

            {/* 12-ay trend */}
            <div className="rounded-2xl border border-border/60 p-4">
              <div className="text-xs font-medium text-muted-foreground mb-3">
                {year} — Aylık Mavi Hediye Çeki Trendi (tüm Derimod)
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.monthly_trend} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickFormatter={(v: string) => v.split(" ")[0] ?? v}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickFormatter={(v: number) => fmtShort(v)}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                  />
                  <Tooltip
                    formatter={(v) => [`${TRY2.format(Number(v))} ₺`, "Mavi Hediye Çeki"]}
                    contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
                  />
                  <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                    {data.monthly_trend.map((m, i) => (
                      <Cell
                        key={i}
                        fill={m.month === month ? "#2563EB" : "#BFDBFE"}
                        opacity={m.total >= maxMonthly * 0.99 ? 1 : 0.9}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Pill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "slate";
}) {
  const cls = {
    blue: "bg-blue-50 text-blue-700 border-blue-200/70",
    slate: "bg-slate-50 text-slate-700 border-slate-200/70",
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-sm font-semibold tabular-nums">
        {value}
        <span className="text-xs font-normal opacity-70 ml-1">₺</span>
      </div>
    </div>
  );
}
