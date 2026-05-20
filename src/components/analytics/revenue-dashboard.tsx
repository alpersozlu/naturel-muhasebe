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
  AreaChart,
  Area,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CreditCard,
  Minus,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { ChartSkeleton, StatCardSkeleton } from "@/components/shared/skeleton";
import { useCountUp } from "@/lib/use-count-up";
import type { RevenueSummary } from "@/server/services/analytics/revenue";

// ───────────────── Formatters ─────────────────
const TRY0 = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const TRY2 = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmtMoney = (n: number) => TRY2.format(n);
const fmtMoneyShort = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${TRY0.format(n / 1_000_000)}M`;
  if (Math.abs(n) >= 1_000) return `${TRY0.format(n / 1_000)}K`;
  return TRY0.format(n);
};
const fmtPct = (n: number, digits = 1) =>
  `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;

const MONTH_LABELS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

// ───────────────── Color tokens ─────────────────
const POS_COLOR = "#6366F1";
const CASH_COLOR = "#10B981";
const SPARK_COLOR = "#6366F1";
const BANK_COLORS = [
  "#6366F1", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#0EA5E9",
];

// ───────────────── Utilities ─────────────────
function pctChange(current: number, prev: number): number | null {
  if (prev <= 0) return null;
  return ((current - prev) / prev) * 100;
}

function TrendChip({
  value,
  label,
}: {
  value: number | null;
  label: string;
}) {
  if (value === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3.5 w-3.5" />
        <span>—</span>
        <span className="text-muted-foreground/80">{label}</span>
      </span>
    );
  }
  const positive = value >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  const tone = positive ? "text-emerald-600" : "text-rose-600";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium tabular-nums ${tone}`}>
      <Icon className="h-3.5 w-3.5" />
      <span>{fmtPct(value, value > -10 && value < 10 ? 1 : 0)}</span>
      <span className="text-muted-foreground font-normal">{label}</span>
    </span>
  );
}

// ───────────────── Hero ─────────────────
function HeroSection({ data, month, year }: { data: RevenueSummary; month: number; year: number }) {
  const animated = useCountUp(data.total, 900);
  const mom = pctChange(data.total, data.prev_month_total);
  const yoy = pctChange(data.total, data.prev_year_total);
  const sparkData = data.sparkline.map((s) => ({ ...s }));

  return (
    <Card className="overflow-hidden animate-fade-in">
      <CardContent className="p-0">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">
          {/* Left: Big number */}
          <div className="lg:col-span-3 p-8 lg:p-10 flex flex-col justify-center">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              {MONTH_LABELS[month - 1]} {year} · Toplam Gelir
            </div>
            <div className="mt-3 text-5xl lg:text-6xl font-semibold tabular-nums tracking-tight text-foreground">
              {fmtMoney(animated)}
              <span className="text-2xl font-normal text-muted-foreground ml-2">₺</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              <TrendChip value={mom} label="geçen aydan" />
              <TrendChip value={yoy} label="geçen yıldan" />
              <span className="text-xs text-muted-foreground">
                {data.active_days} aktif gün · Günlük ort. {fmtMoneyShort(data.daily_avg)} ₺
              </span>
            </div>
          </div>

          {/* Right: 12-month sparkline */}
          <div className="lg:col-span-2 bg-gradient-to-br from-indigo-50/40 to-transparent border-t lg:border-t-0 lg:border-l border-border/60">
            <div className="p-6 lg:p-8 h-full flex flex-col justify-center">
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Son 12 ay
              </div>
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={sparkData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SPARK_COLOR} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={SPARK_COLOR} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip
                    cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 3" }}
                    formatter={(v) => [`${fmtMoney(Number(v))} ₺`, ""]}
                    labelFormatter={(l) => String(l)}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke={SPARK_COLOR}
                    strokeWidth={2}
                    fill="url(#sparkFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
                <span>{sparkData[0]?.label}</span>
                <span>{sparkData[sparkData.length - 1]?.label}</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────── Secondary stats (4 small) ─────────────────
function SecondaryStats({ data }: { data: RevenueSummary }) {
  const items = [
    {
      icon: Wallet,
      label: "Nakit",
      value: data.cash,
      pct: data.total > 0 ? (data.cash / data.total) * 100 : 0,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      icon: CreditCard,
      label: "POS / Kart",
      value: data.pos,
      pct: data.total > 0 ? (data.pos / data.total) * 100 : 0,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
    },
    {
      icon: TrendingUp,
      label: "Günlük Ortalama",
      value: data.daily_avg,
      pct: null as number | null,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      icon: Banknote,
      label: "Aktif Gün",
      value: data.active_days,
      pct: null as number | null,
      color: "text-purple-600",
      bg: "bg-purple-50",
      isCount: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map((it) => (
        <SmallStat key={it.label} {...it} />
      ))}
    </div>
  );
}

function SmallStat({
  icon: Icon,
  label,
  value,
  pct,
  color,
  bg,
  isCount,
}: {
  icon: typeof Wallet;
  label: string;
  value: number;
  pct: number | null;
  color: string;
  bg: string;
  isCount?: boolean;
}) {
  const animated = useCountUp(value, 700);
  return (
    <Card className="hover:shadow-sm transition-shadow animate-slide-up">
      <CardContent className="p-4">
        <div className="flex items-center gap-2.5 mb-2">
          <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${bg} ${color}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
        <div className="text-xl font-semibold tabular-nums tracking-tight">
          {isCount ? Math.round(animated) : fmtMoney(animated)}
          {!isCount ? <span className="text-sm font-normal text-muted-foreground ml-1">₺</span> : null}
        </div>
        {pct !== null ? (
          <div className="text-xs text-muted-foreground mt-1 tabular-nums">
            %{pct.toFixed(1)} pay
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ───────────────── Narrative insights ─────────────────
function generateInsights(data: RevenueSummary, month: number): string[] {
  const out: string[] = [];

  // 1. MoM trend
  const mom = pctChange(data.total, data.prev_month_total);
  if (mom !== null && Math.abs(mom) >= 3) {
    const dir = mom >= 0 ? "yüksek" : "düşük";
    out.push(
      `Bu ay toplam ciro geçen aya göre %${Math.abs(mom).toFixed(1)} ${dir}.`
    );
  }

  // 2. Best day in current month
  const bestDay = [...data.daily_series].sort((a, b) => b.total - a.total)[0];
  if (bestDay && bestDay.total > 0) {
    out.push(
      `Ayın en güçlü günü ${bestDay.day} ${MONTH_LABELS[month - 1]} — ${fmtMoneyShort(bestDay.total)} ₺ ciro yapıldı.`
    );
  }

  // 3. Weekend vs weekday avg
  const wd = data.weekday_pattern;
  if (wd.length === 7) {
    const weekdayAvg =
      wd.slice(0, 5).reduce((s, d) => s + (d.days > 0 ? d.avg : 0), 0) /
      Math.max(1, wd.slice(0, 5).filter((d) => d.days > 0).length);
    const weekendAvg =
      wd.slice(5).reduce((s, d) => s + (d.days > 0 ? d.avg : 0), 0) /
      Math.max(1, wd.slice(5).filter((d) => d.days > 0).length);
    if (weekdayAvg > 0 && weekendAvg > 0) {
      const diff = ((weekendAvg - weekdayAvg) / weekdayAvg) * 100;
      if (Math.abs(diff) >= 8) {
        const dir = diff > 0 ? "yüksek" : "düşük";
        out.push(
          `Hafta sonu günlük ortalaması, hafta içine göre %${Math.abs(diff).toFixed(0)} ${dir}.`
        );
      }
    }
  }

  // 4. Top store contribution
  if (data.by_store.length >= 2 && data.total > 0) {
    const top = data.by_store[0];
    if (top) {
      const share = (top.total / data.total) * 100;
      if (share >= 30) {
        out.push(
          `${top.store_name}, ayın toplam cirosunun %${share.toFixed(0)}'ını tek başına üretti.`
        );
      }
    }
  }

  // 5. Brand comparison (if 2+ brands)
  if (data.by_brand.length >= 2) {
    const [b1, b2] = data.by_brand;
    if (b1 && b2 && b1.total > 0 && b2.total > 0) {
      const diff = ((b1.total - b2.total) / b2.total) * 100;
      if (diff >= 10) {
        out.push(
          `${b1.brand_name}, ${b2.brand_name}'den %${diff.toFixed(0)} daha fazla ciro yapıyor.`
        );
      }
    }
  }

  // 6. Cash ratio drop warning
  const cr = data.cash_ratio_trend;
  if (cr.length === 3 && cr.every((c) => c.total > 0)) {
    const ratios = cr.map((c) => c.ratio * 100);
    const isStrictlyDescending = ratios[0]! > ratios[1]! && ratios[1]! > ratios[2]!;
    const totalDrop = ratios[0]! - ratios[2]!;
    if (isStrictlyDescending && totalDrop >= 3) {
      out.push(
        `Nakit oranı son 3 ayda %${ratios[0]!.toFixed(0)} → %${ratios[1]!.toFixed(0)} → %${ratios[2]!.toFixed(0)} düşüşünde — bir mağazada kasa sızıntısı olabilir.`
      );
    }
  }

  return out.slice(0, 4);
}

function InsightsCard({ data, month }: { data: RevenueSummary; month: number }) {
  const insights = generateInsights(data, month);
  if (insights.length === 0) return null;
  return (
    <Card className="animate-fade-in bg-gradient-to-br from-indigo-50/50 via-transparent to-transparent">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-7 w-7 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="font-semibold">Bu Ayda Ne Oldu?</div>
        </div>
        <ul className="space-y-2.5">
          {insights.map((line, i) => (
            <li key={i} className="text-sm text-foreground/90 leading-relaxed flex gap-2.5">
              <span className="text-indigo-400 mt-1">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ───────────────── Leaderboard ─────────────────
function Leaderboard({ data }: { data: RevenueSummary }) {
  if (data.by_store.length === 0) return null;
  const max = data.by_store[0]?.total ?? 0;
  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5">
        <div className="font-semibold mb-1">Mağaza Sıralaması</div>
        <div className="text-xs text-muted-foreground mb-4">
          Bu ay aktif olan mağazalar — toplam ciroya göre
        </div>
        <div className="space-y-3">
          {data.by_store.map((s, i) => {
            const share = data.total > 0 ? (s.total / data.total) * 100 : 0;
            const widthPct = max > 0 ? (s.total / max) * 100 : 0;
            const color = BANK_COLORS[i % BANK_COLORS.length] ?? POS_COLOR;
            return (
              <div key={s.store_id}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <div className="text-sm font-medium text-foreground flex items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums w-4">
                      {i + 1}
                    </span>
                    {s.store_name}
                  </div>
                  <div className="text-sm tabular-nums">
                    <span className="font-semibold">{fmtMoneyShort(s.total)}</span>
                    <span className="text-muted-foreground ml-1.5">₺</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      %{share.toFixed(1)}
                    </span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${widthPct}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────── Weekday pattern ─────────────────
function WeekdayPattern({ data }: { data: RevenueSummary }) {
  const wd = data.weekday_pattern;
  if (wd.length === 0 || wd.every((w) => w.total === 0)) return null;
  const maxAvg = Math.max(...wd.map((w) => w.avg));
  const bestIdx = wd.findIndex((w) => w.avg === maxAvg && maxAvg > 0);
  const chartData = wd.map((w, i) => ({
    label: w.label,
    avg: w.avg,
    days: w.days,
    isBest: i === bestIdx,
  }));

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5">
        <div className="font-semibold mb-1">Hafta Günü Deseni</div>
        <div className="text-xs text-muted-foreground mb-4">
          Hangi gün ne kadar satıyor — günlük ortalama
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="label"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${TRY0.format(v / 1000)}K`}
              width={36}
            />
            <Tooltip
              formatter={(v) => [`${fmtMoney(Number(v))} ₺`, "Günlük ort."]}
              labelFormatter={(l) => String(l)}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              cursor={{ fill: "#f8fafc" }}
            />
            <Bar dataKey="avg" radius={[6, 6, 0, 0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.isBest ? POS_COLOR : "#c7d2fe"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {bestIdx >= 0 && wd[bestIdx] ? (
          <div className="mt-3 text-xs text-muted-foreground">
            En güçlü gün: <span className="text-foreground font-medium">{wd[bestIdx].label}</span> ·{" "}
            günlük ort. {fmtMoneyShort(wd[bestIdx].avg)} ₺
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ───────────────── Cash health ─────────────────
function CashHealth({ data }: { data: RevenueSummary }) {
  const cashPct = data.total > 0 ? (data.cash / data.total) * 100 : 0;
  const posPct = data.total > 0 ? (data.pos / data.total) * 100 : 0;
  const cr = data.cash_ratio_trend;
  const ratios = cr.map((c) => c.ratio * 100);

  let healthTone: "ok" | "warn" | "alert" = "ok";
  let healthMsg = "Nakit oranı sağlıklı seyrediyor.";
  if (ratios.length === 3 && ratios[0]! > 0) {
    const isDescending = ratios[0]! > ratios[1]! && ratios[1]! > ratios[2]!;
    const drop = ratios[0]! - ratios[2]!;
    if (isDescending && drop >= 5) {
      healthTone = "alert";
      healthMsg = `Nakit oranı 3 ay üst üste düşüyor (${drop.toFixed(0)} puan). Mağaza özetlerine yakın bak.`;
    } else if (isDescending && drop >= 2) {
      healthTone = "warn";
      healthMsg = "Nakit oranında hafif düşüş eğilimi var.";
    }
  }

  const toneClass =
    healthTone === "alert"
      ? "text-rose-600 bg-rose-50 border-rose-200"
      : healthTone === "warn"
        ? "text-amber-700 bg-amber-50 border-amber-200"
        : "text-emerald-700 bg-emerald-50 border-emerald-200";

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5">
        <div className="font-semibold mb-1">Nakit / POS Sağlığı</div>
        <div className="text-xs text-muted-foreground mb-4">
          Cari ay dağılımı + son 3 ay trendi
        </div>

        {/* Bar split */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-muted-foreground w-12">POS</span>
          <div className="flex-1 h-2 rounded-full bg-muted/50 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${posPct}%`, backgroundColor: POS_COLOR }}
            />
          </div>
          <span className="text-xs tabular-nums font-medium w-12 text-right">
            %{posPct.toFixed(1)}
          </span>
        </div>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-muted-foreground w-12">Nakit</span>
          <div className="flex-1 h-2 rounded-full bg-muted/50 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${cashPct}%`, backgroundColor: CASH_COLOR }}
            />
          </div>
          <span className="text-xs tabular-nums font-medium w-12 text-right">
            %{cashPct.toFixed(1)}
          </span>
        </div>

        {/* 3-month trend */}
        {cr.length === 3 ? (
          <div className="border-t pt-4">
            <div className="text-xs text-muted-foreground mb-2">Nakit oranı — son 3 ay</div>
            <div className="grid grid-cols-3 gap-2">
              {cr.map((c, i) => {
                const pct = c.ratio * 100;
                const isLast = i === 2;
                return (
                  <div
                    key={c.month_key}
                    className={`rounded-lg p-2 text-center ${
                      isLast ? "bg-muted/40" : ""
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {c.label}
                    </div>
                    <div
                      className={`text-base font-semibold tabular-nums mt-0.5 ${
                        isLast ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      %{pct.toFixed(1)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={`mt-3 text-xs rounded-lg border px-3 py-2 ${toneClass}`}>
              {healthMsg}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ───────────────── Brand split ─────────────────
function BrandSplit({ data }: { data: RevenueSummary }) {
  if (data.by_brand.length < 2) return null;
  const ranked = [...data.by_brand].sort((a, b) => b.total - a.total).slice(0, 2);
  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5">
        <div className="font-semibold mb-1">Marka Karşılaştırması</div>
        <div className="text-xs text-muted-foreground mb-4">
          İki marka, yan yana
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ranked.map((b) => {
            const mom = pctChange(b.total, b.prev_month_total);
            const cashPct = b.total > 0 ? (b.cash / b.total) * 100 : 0;
            return (
              <div
                key={b.brand_id}
                className="rounded-2xl border border-border/60 p-4 bg-gradient-to-br from-muted/20 to-transparent"
              >
                <div className="flex items-baseline justify-between mb-1">
                  <div className="font-semibold">{b.brand_name}</div>
                  <TrendChip value={mom} label="geçen aya göre" />
                </div>
                <div className="text-2xl font-semibold tabular-nums tracking-tight mt-1">
                  {fmtMoneyShort(b.total)}
                  <span className="text-sm font-normal text-muted-foreground ml-1">₺</span>
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  Nakit %{cashPct.toFixed(1)} · POS %{(100 - cashPct).toFixed(1)}
                </div>
                <div className="mt-3 -mx-1">
                  <ResponsiveContainer width="100%" height={48}>
                    <AreaChart data={b.sparkline} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
                      <defs>
                        <linearGradient id={`bspark-${b.brand_id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={POS_COLOR} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={POS_COLOR} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="total"
                        stroke={POS_COLOR}
                        strokeWidth={1.5}
                        fill={`url(#bspark-${b.brand_id})`}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────── Daily series (existing, slightly polished) ─────────────────
function DailySeries({ data }: { data: RevenueSummary }) {
  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5">
        <div className="font-semibold mb-1">Günlük Görünüm</div>
        <div className="text-xs text-muted-foreground mb-4">
          Ay boyunca nakit ve POS dağılımı
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.daily_series}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="day" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${TRY0.format(v / 1000)}K`}
            />
            <Tooltip
              formatter={(v) => [`${fmtMoney(Number(v))} ₺`, ""]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              labelFormatter={(d) => `Gün ${d}`}
            />
            <Bar dataKey="cash" stackId="a" fill={CASH_COLOR} name="Nakit" />
            <Bar dataKey="pos" stackId="a" fill={POS_COLOR} name="POS" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ───────────────── Bank breakdown (existing) ─────────────────
function BankBreakdown({ data }: { data: RevenueSummary }) {
  if (data.by_bank.length === 0) return null;
  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5">
        <div className="font-semibold mb-1">Banka Bazında POS</div>
        <div className="text-xs text-muted-foreground mb-4">
          Hangi banka POS'undan ne kadar geldi
        </div>
        <ResponsiveContainer width="100%" height={Math.max(180, data.by_bank.length * 36)}>
          <BarChart data={data.by_bank} layout="vertical" margin={{ left: 10 }}>
            <XAxis
              type="number"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${TRY0.format(v / 1000)}K`}
            />
            <YAxis
              type="category"
              dataKey="bank_name"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={110}
            />
            <Tooltip
              formatter={(v) => [`${fmtMoney(Number(v))} ₺`, "POS"]}
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
            />
            <Bar dataKey="total" fill={POS_COLOR} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ───────────────── Root ─────────────────
export function RevenueDashboard({
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
  const { data, isLoading } = trpc.analytics.revenue.useQuery({
    brand_id: brandId || undefined,
    store_id: storeId || undefined,
    year,
    month,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <ChartSkeleton height={200} />
        <StatCardSkeleton count={4} />
        <ChartSkeleton height={120} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartSkeleton height={220} />
          <ChartSkeleton height={220} />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const isEmpty = data.total === 0 && data.active_days === 0;

  if (isEmpty) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground animate-fade-in">
          <Banknote className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">Bu ay için gelir verisi yok</div>
          <div className="text-sm mt-1">
            Mağaza Özeti yüklendikten sonra burada gözükür.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <HeroSection data={data} month={month} year={year} />
      <SecondaryStats data={data} />
      <InsightsCard data={data} month={month} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Leaderboard data={data} />
        <WeekdayPattern data={data} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BrandSplit data={data} />
        <CashHealth data={data} />
      </div>

      <DailySeries data={data} />
      <BankBreakdown data={data} />
    </div>
  );
}
