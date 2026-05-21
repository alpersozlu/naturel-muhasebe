"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Banknote, Percent } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { useCountUp } from "@/lib/use-count-up";
import { ChartSkeleton } from "@/components/shared/skeleton";
import type { BankCommissionSummary } from "@/server/services/analytics/bank-commission";

// ───── Formatters ─────
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

const MONTH_LABELS_SHORT = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];

const COMMISSION_COLOR = "#EF4444"; // rose-500 — gider rengi
const PREV_YEAR_COLOR = "#94A3B8"; // slate-400

function shortPeriodLabel(year: number, month: number): string {
  return `${MONTH_LABELS_SHORT[month - 1]} ${year}`;
}
function prevMonthOf(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}
function pctChange(current: number, prev: number): number | null {
  if (prev <= 0) return null;
  return ((current - prev) / prev) * 100;
}

function TrendChip({
  value,
  periodLabel,
}: {
  value: number | null;
  periodLabel: string;
}) {
  if (value === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
        <ArrowUpRight className="h-3.5 w-3.5" />
        <span>vs. {periodLabel}</span>
      </span>
    );
  }
  // Gider tarafı: artış = kötü (kırmızı), azalış = iyi (yeşil)
  const positive = value >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  const tone = positive ? "text-rose-600" : "text-emerald-600";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium tabular-nums ${tone}`}>
      <Icon className="h-3.5 w-3.5" />
      <span>{fmtPct(value, value > -10 && value < 10 ? 1 : 0)}</span>
      <span className={`font-normal ${tone}`}>vs. {periodLabel}</span>
    </span>
  );
}

// ───── Root ─────
export function BankCommissionBlock({
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
  const { data, isLoading } = trpc.analytics.bankCommission.useQuery({
    brand_id: brandId || undefined,
    store_id: storeId || undefined,
    year,
    month,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <ChartSkeleton height={140} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartSkeleton height={240} />
          <ChartSkeleton height={240} />
        </div>
      </div>
    );
  }

  if (!data) return null;
  const isEmpty = data.total === 0 && data.yearly_compare.current_ytd === 0;

  return (
    <section className="space-y-4">
      <SectionHeader />
      <Hero data={data} month={month} year={year} />
      {!isEmpty ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BankTable data={data} month={month} year={year} />
            <YearlyCompare data={data} year={year} />
          </div>
        </>
      ) : (
        <EmptyState />
      )}
    </section>
  );
}

function SectionHeader() {
  return (
    <div className="flex items-center gap-3 pt-4">
      <div className="h-8 w-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
        <Percent className="h-4 w-4" />
      </div>
      <div>
        <div className="font-semibold text-base">Banka POS Komisyonu</div>
        <div className="text-xs text-muted-foreground">
          Her POS cirosundan bankaya ödenen komisyon — şu an varsayılan %5
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="py-12 text-center text-muted-foreground">
        <Banknote className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <div className="font-medium text-foreground">
          Bu dönemde POS işlemi bulunamadı
        </div>
        <div className="text-sm mt-1">
          POS slipleri yüklendiğinde komisyon otomatik hesaplanır.
        </div>
      </CardContent>
    </Card>
  );
}

function Hero({
  data,
  month,
  year,
}: {
  data: BankCommissionSummary;
  month: number;
  year: number;
}) {
  const animated = useCountUp(data.total, 900);
  const mom = pctChange(data.total, data.prev_month_total);
  const yoy = pctChange(data.total, data.prev_year_total);
  const prevM = prevMonthOf(year, month);
  const momLabel = shortPeriodLabel(prevM.year, prevM.month);
  const yoyLabel = shortPeriodLabel(year - 1, month);
  const effectivePct = data.effective_rate * 100;

  return (
    <Card className="overflow-hidden animate-fade-in">
      <CardContent className="p-0">
        <div className="grid grid-cols-1 lg:grid-cols-5">
          <div className="lg:col-span-3 p-6 lg:p-8">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              {MONTH_LABELS_SHORT[month - 1]} {year} · Toplam Komisyon Gideri
            </div>
            <div className="mt-2 text-4xl lg:text-5xl font-semibold tabular-nums tracking-tight">
              {fmtMoney(animated)}
              <span className="text-xl font-normal text-muted-foreground ml-2">₺</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              <TrendChip value={mom} periodLabel={momLabel} />
              <TrendChip value={yoy} periodLabel={yoyLabel} />
              <span className="text-xs text-muted-foreground tabular-nums">
                POS cirosu {fmtMoneyShort(data.total_gross)} ₺ · efektif oran %
                {effectivePct.toFixed(2)}
              </span>
            </div>
          </div>
          <div className="lg:col-span-2 bg-gradient-to-br from-rose-50/40 to-transparent border-t lg:border-t-0 lg:border-l border-border/60 p-5 lg:p-6">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">
              Son 12 ay
            </div>
            <ResponsiveContainer width="100%" height={100}>
              <AreaChart data={data.sparkline} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="commSpark" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COMMISSION_COLOR} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={COMMISSION_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip
                  cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 3" }}
                  formatter={(v) => [`${fmtMoney(Number(v))} ₺`, "Komisyon"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke={COMMISSION_COLOR}
                  strokeWidth={2}
                  fill="url(#commSpark)"
                />
              </AreaChart>
            </ResponsiveContainer>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>{data.sparkline[0]?.label}</span>
              <span>{data.sparkline[data.sparkline.length - 1]?.label}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BankTable({
  data,
  month,
  year,
}: {
  data: BankCommissionSummary;
  month: number;
  year: number;
}) {
  const prevM = prevMonthOf(year, month);
  const momLabel = shortPeriodLabel(prevM.year, prevM.month);

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5">
        <div className="font-semibold mb-1">Banka Bazında Komisyon</div>
        <div className="text-xs text-muted-foreground mb-4">
          POS cirosundan ne kadar bankaya gidiyor
        </div>
        {data.by_bank.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            Bu ay POS verisi yok
          </div>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left font-medium pb-2 px-1">Banka</th>
                  <th className="text-right font-medium pb-2 px-1">POS Cirosu</th>
                  <th className="text-right font-medium pb-2 px-1">Oran</th>
                  <th className="text-right font-medium pb-2 px-1">Komisyon</th>
                  <th className="text-right font-medium pb-2 px-1">{momLabel}</th>
                </tr>
              </thead>
              <tbody>
                {data.by_bank.map((b) => {
                  const mom = pctChange(b.commission, b.prev_month_commission);
                  return (
                    <tr
                      key={b.bank_name}
                      className="border-t border-border/40 hover:bg-muted/30 transition-colors"
                    >
                      <td className="py-2.5 px-1 font-medium text-foreground">
                        {b.bank_name}
                      </td>
                      <td className="py-2.5 px-1 text-right tabular-nums text-muted-foreground">
                        {fmtMoneyShort(b.gross)} ₺
                      </td>
                      <td className="py-2.5 px-1 text-right tabular-nums">
                        %{(b.rate * 100).toFixed(1)}
                      </td>
                      <td className="py-2.5 px-1 text-right tabular-nums font-semibold text-rose-600">
                        {fmtMoney(b.commission)} ₺
                      </td>
                      <td className="py-2.5 px-1 text-right">
                        <MomMini value={mom} prev={b.prev_month_commission} />
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-border">
                  <td className="py-3 px-1 text-xs uppercase tracking-wider text-muted-foreground">
                    Toplam
                  </td>
                  <td className="py-3 px-1 text-right tabular-nums text-muted-foreground">
                    {fmtMoneyShort(data.total_gross)} ₺
                  </td>
                  <td className="py-3 px-1 text-right tabular-nums text-muted-foreground">
                    %{(data.effective_rate * 100).toFixed(2)}
                  </td>
                  <td className="py-3 px-1 text-right tabular-nums font-bold text-rose-700">
                    {fmtMoney(data.total)} ₺
                  </td>
                  <td className="py-3 px-1"></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MomMini({ value, prev }: { value: number | null; prev: number }) {
  if (value === null) {
    return <span className="text-xs text-muted-foreground tabular-nums">—</span>;
  }
  // Gider: artış = kötü
  const positive = value >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  const tone = positive ? "text-rose-600" : "text-emerald-600";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs tabular-nums font-medium ${tone}`}>
      <Icon className="h-3 w-3" />
      {fmtPct(value, Math.abs(value) < 10 ? 1 : 0)}
      <span className="text-[10px] text-muted-foreground font-normal ml-1">
        ({fmtMoneyShort(prev)})
      </span>
    </span>
  );
}

function YearlyCompare({
  data,
  year,
}: {
  data: BankCommissionSummary;
  year: number;
}) {
  const ytdMom = pctChange(data.yearly_compare.current_ytd, data.yearly_compare.prev_ytd);
  // 0'lar serpiştirilmesin diye min güvenli görünüm: hep 12 ay
  const chartData = data.yearly_compare.months.map((m) => ({
    label: m.label,
    bu_yil: m.current,
    gecen_yil: m.prev,
  }));

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5">
        <div className="flex items-baseline justify-between mb-1">
          <div className="font-semibold">Yıllık Karşılaştırma</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {year - 1} vs {year}
          </div>
        </div>
        <div className="text-xs text-muted-foreground mb-3">
          Bu yıl ile geçen yılın komisyon trendi yan yana
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-xl border border-border/60 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              YTD {year}
            </div>
            <div className="text-lg font-semibold tabular-nums text-rose-600">
              {fmtMoneyShort(data.yearly_compare.current_ytd)}
              <span className="text-xs font-normal text-muted-foreground ml-1">₺</span>
            </div>
          </div>
          <div className="rounded-xl border border-border/60 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              YTD {year - 1}
            </div>
            <div className="text-lg font-semibold tabular-nums text-muted-foreground">
              {fmtMoneyShort(data.yearly_compare.prev_ytd)}
              <span className="text-xs font-normal text-muted-foreground ml-1">₺</span>
            </div>
            {ytdMom !== null ? (
              <div className="mt-0.5">
                <MomMini value={ytdMom} prev={data.yearly_compare.prev_ytd} />
              </div>
            ) : null}
          </div>
        </div>

        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" fontSize={10} tickLine={false} axisLine={false} />
            <YAxis
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${TRY0.format(v / 1000)}K`}
              width={32}
            />
            <Tooltip
              formatter={(v, name) => [
                `${fmtMoney(Number(v))} ₺`,
                name === "bu_yil" ? String(year) : String(year - 1),
              ]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              cursor={{ fill: "#f8fafc" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
              formatter={(name) => (name === "bu_yil" ? String(year) : String(year - 1))}
            />
            <Bar dataKey="gecen_yil" fill={PREV_YEAR_COLOR} radius={[3, 3, 0, 0]} />
            <Bar dataKey="bu_yil" fill={COMMISSION_COLOR} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

