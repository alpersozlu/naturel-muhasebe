"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LineChart,
  Line,
  Cell,
  ComposedChart,
  ReferenceLine,
  Legend,
} from "recharts";
import { Wallet, Receipt, Users, Store, TrendingUp, Target } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "./stat-card";
import { StatCardSkeleton, ChartSkeleton } from "@/components/shared/skeleton";
import type { ExpenseSummary } from "@/server/services/analytics/expense";

const TRY = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const TRY2 = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmtMoneyShort = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${TRY.format(n / 1_000_000)}M`;
  if (Math.abs(n) >= 1_000) return `${TRY.format(n / 1_000)}K`;
  return TRY.format(n);
};

const CATEGORY_LABEL: Record<string, string> = {
  rent: "Kira",
  electricity: "Elektrik",
  water: "Su",
  internet: "İnternet",
  stationery: "Kırtasiye",
  cleaning: "Temizlik",
  maintenance: "Bakım",
  salary: "Maaş",
  bonus: "Prim/Avans",
  supplies: "Sarf Malzeme",
  marketing: "Pazarlama",
  other: "Diğer",
};

const TREND_COLOR = "#8B5CF6";
const PROJECTION_COLOR = "#C4B5FD"; // violet-300
const PARETO_BAR_COLOR = "#EF4444";
const PARETO_LINE_COLOR = "#1E293B"; // slate-800 — cumulative line
const REF_80_COLOR = "#F59E0B"; // amber-500 — 80% reference

export function ExpenseDashboard({
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
  const { data, isLoading } = trpc.analytics.expense.useQuery({
    brand_id: brandId || undefined,
    store_id: storeId || undefined,
    year,
    month,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <StatCardSkeleton count={4} />
        <ChartSkeleton height={300} />
        <ChartSkeleton height={240} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartSkeleton height={200} />
          <ChartSkeleton height={200} />
        </div>
      </div>
    );
  }

  if (!data || data.total === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground animate-fade-in">
          <Wallet className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">Bu ay için gider verisi yok</div>
          <div className="text-sm mt-1">
            Masraf/Fatura veya Faturasız Peşin Ödeme girildikten sonra burada gözükür.
          </div>
        </CardContent>
      </Card>
    );
  }

  const topCategory = data.by_category[0];
  const topStore = data.by_store[0];
  const topEmployee = data.by_employee[0];

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Wallet}
          label="Toplam Gider"
          value={data.total}
          color="text-rose-600"
          bgColor="bg-rose-50"
          hint={`${data.count} kayıt`}
        />
        <StatCard
          icon={Receipt}
          label={topCategory ? CATEGORY_LABEL[topCategory.category] ?? topCategory.category : "—"}
          value={topCategory?.total ?? 0}
          color="text-amber-600"
          bgColor="bg-amber-50"
          hint="En çok harcanan kategori"
        />
        <StatCard
          icon={Store}
          label={topStore?.store_name ?? "—"}
          value={topStore?.total ?? 0}
          color="text-indigo-600"
          bgColor="bg-indigo-50"
          hint="En çok harcayan mağaza"
        />
        <StatCard
          icon={Users}
          label={topEmployee?.employee_name ?? "—"}
          value={topEmployee?.total ?? 0}
          color="text-purple-600"
          bgColor="bg-purple-50"
          hint="En çok harcayan çalışan"
        />
      </div>

      {/* Yearly Trend + Projection */}
      <YearlyTrendCard data={data} month={month} year={year} />

      {/* Pareto */}
      <ParetoCard data={data} />

      {/* Bottom row: Employee + Store */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="font-semibold mb-1">Çalışana Göre</div>
            <div className="text-xs text-muted-foreground mb-4">Kişi başına harcama</div>
            {data.by_employee.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">Veri yok</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(180, data.by_employee.length * 36)}>
                <BarChart data={data.by_employee} layout="vertical" margin={{ left: 10 }}>
                  <XAxis
                    type="number"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${TRY.format(v / 1000)}K`}
                  />
                  <YAxis
                    type="category"
                    dataKey="employee_name"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={120}
                  />
                  <Tooltip
                    formatter={(v) => [`${TRY2.format(Number(v))} ₺`, "Gider"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="total" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="font-semibold mb-1">Mağazaya Göre</div>
            <div className="text-xs text-muted-foreground mb-4">Mağaza başına harcama</div>
            {data.by_store.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">Veri yok</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(180, data.by_store.length * 36)}>
                <BarChart data={data.by_store} layout="vertical" margin={{ left: 10 }}>
                  <XAxis
                    type="number"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${TRY.format(v / 1000)}K`}
                  />
                  <YAxis
                    type="category"
                    dataKey="store_name"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={100}
                  />
                  <Tooltip
                    formatter={(v) => [`${TRY2.format(Number(v))} ₺`, "Gider"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="total" fill="#6366F1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ───── Yearly Trend with Projection ─────
function YearlyTrendCard({
  data,
  month,
  year,
}: {
  data: ExpenseSummary;
  month: number;
  year: number;
}) {
  const series = data.yearly_with_projection;
  if (series.length === 0) return null;
  const currentLabel = series[month - 1]?.label;
  const projectionRatio =
    data.ytd_total > 0 && data.projected_year_end > 0
      ? (data.projected_year_end / data.ytd_total - 1) * 100
      : 0;

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div>
            <div className="font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-violet-600" />
              Yıllık Trend + Yıl Sonu Projeksiyonu
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {year} yılı boyunca aylık gider — kesikli çizgi mevcut hızda projeksiyon
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Pill label={`YTD ${year}`} value={fmtMoneyShort(data.ytd_total)} tone="violet" />
            <Pill
              label="Aylık Ortalama"
              value={fmtMoneyShort(data.projected_monthly_avg)}
              tone="slate"
            />
            <Pill
              label="Yıl Sonu Tahmini"
              value={fmtMoneyShort(data.projected_year_end)}
              tone="amber"
              hint={
                data.ytd_total > 0
                  ? `${data.ytd_total > 0 ? "+" : ""}${projectionRatio.toFixed(0)}% YTD üzeri`
                  : undefined
              }
            />
          </div>
        </div>

        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" fontSize={10} tickLine={false} axisLine={false} interval={0} />
            <YAxis
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${TRY.format(v / 1000)}K`}
              width={48}
            />
            <Tooltip
              formatter={(v, name) => [
                `${TRY2.format(Number(v))} ₺`,
                name === "actual" ? "Gerçekleşen" : "Projeksiyon",
              ]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
              formatter={(name) =>
                name === "actual" ? "Gerçekleşen" : "Mevcut hızda projeksiyon"
              }
            />
            {currentLabel ? (
              <ReferenceLine
                x={currentLabel}
                stroke="#cbd5e1"
                strokeDasharray="2 4"
                label={{
                  value: "Bugün",
                  position: "top",
                  fontSize: 10,
                  fill: "#64748b",
                }}
              />
            ) : null}
            <Line
              type="monotone"
              dataKey="actual"
              stroke={TREND_COLOR}
              strokeWidth={2.5}
              dot={{ r: 3, fill: TREND_COLOR }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="projected"
              stroke={PROJECTION_COLOR}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 2, fill: PROJECTION_COLOR }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function Pill({
  label,
  value,
  hint,
  tone = "slate",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "violet" | "amber" | "slate";
}) {
  const toneClass = {
    violet: "bg-violet-50 text-violet-700 border-violet-200/70",
    amber: "bg-amber-50 text-amber-700 border-amber-200/70",
    slate: "bg-slate-50 text-slate-700 border-slate-200/70",
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-sm font-semibold tabular-nums">
        {value}
        <span className="text-xs font-normal opacity-70 ml-1">₺</span>
      </div>
      {hint ? <div className="text-[10px] opacity-70 mt-0.5">{hint}</div> : null}
    </div>
  );
}

// ───── Pareto / 80-20 ─────
function ParetoCard({
  data,
}: {
  data: ExpenseSummary;
}) {
  if (data.by_category.length === 0 || data.total === 0) return null;

  // Sıralı kategoriler + cumulative %
  let cumulative = 0;
  const items = data.by_category.map((c) => {
    const share = (c.total / data.total) * 100;
    cumulative += share;
    return {
      label: CATEGORY_LABEL[c.category] ?? c.category,
      total: c.total,
      share,
      cumulative,
    };
  });

  // %80'i kapsayan en küçük N
  let nFor80 = items.length;
  for (let i = 0; i < items.length; i++) {
    if (items[i]!.cumulative >= 80) {
      nFor80 = i + 1;
      break;
    }
  }
  const pctOfCategories = (nFor80 / items.length) * 100;
  const insightLine =
    items.length === 1
      ? `Tüm gider tek bir kategoride toplanmış: ${items[0]!.label}. Risk yoğunluğu yüksek.`
      : `${nFor80} kategori (toplam kategori sayısının %${pctOfCategories.toFixed(0)}'i) giderlerin %80'ini oluşturuyor.`;

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4 mb-1 flex-wrap">
          <div>
            <div className="font-semibold flex items-center gap-2">
              <Target className="h-4 w-4 text-rose-600" />
              Pareto Analizi · 80/20
            </div>
            <div className="text-xs text-muted-foreground mt-1">{insightLine}</div>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm" style={{ backgroundColor: PARETO_BAR_COLOR }} />
              Kategori payı (₺)
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-0.5 w-4 inline-block"
                style={{ backgroundColor: PARETO_LINE_COLOR }}
              />
              Kümülatif %
            </span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={items} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} interval={0} />
            <YAxis
              yAxisId="left"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${TRY.format(v / 1000)}K`}
              width={48}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `%${v}`}
              domain={[0, 100]}
              width={40}
            />
            <Tooltip
              formatter={(v, name) => {
                if (name === "cumulative") return [`%${Number(v).toFixed(1)}`, "Kümülatif"];
                return [`${TRY2.format(Number(v))} ₺`, "Kategori"];
              }}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <ReferenceLine
              yAxisId="right"
              y={80}
              stroke={REF_80_COLOR}
              strokeDasharray="4 4"
              label={{
                value: "%80",
                position: "right",
                fontSize: 10,
                fill: REF_80_COLOR,
              }}
            />
            <Bar yAxisId="left" dataKey="total" radius={[6, 6, 0, 0]}>
              {items.map((_, i) => (
                <Cell
                  key={i}
                  fill={i < nFor80 ? PARETO_BAR_COLOR : "#FCA5A5"}
                  fillOpacity={i < nFor80 ? 1 : 0.6}
                />
              ))}
            </Bar>
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="cumulative"
              stroke={PARETO_LINE_COLOR}
              strokeWidth={2}
              dot={{ r: 3, fill: PARETO_LINE_COLOR }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
