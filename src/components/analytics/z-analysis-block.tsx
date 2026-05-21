"use client";

import { useState } from "react";
import {
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  ScrollText,
  AlertTriangle,
  Receipt,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { ChartSkeleton } from "@/components/shared/skeleton";
import { useCountUp } from "@/lib/use-count-up";
import type { ZAnalysisSummary } from "@/server/services/analytics/z-analysis";

const TRY = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const TRY0 = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const fmt = (n: number) => TRY.format(n);
const fmtShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
};

const Z_COLOR = "#0EA5E9"; // sky-500 (Z raporu)
const INVOICE_COLOR = "#A855F7"; // purple-500 (el faturası)
const VISA_COLOR = "#94A3B8"; // slate-400 (visa referansı)

type Store = {
  store_id: string;
  store_name: string;
  brand_name: string;
  z_report_total: number;
  manual_invoice_total: number;
  combined: number;
  visa_total: number;
  cash_total: number;
  sales_total: number;
  days: Array<{
    date: string;
    z_report_total: number;
    manual_invoice_total: number;
    combined: number;
    visa_total: number;
    cash_total: number;
    sales_total: number;
    compliance: "passed" | "below_visa" | "above_sales" | "incomplete";
  }>;
  compliance: "passed" | "below_visa" | "above_sales" | "mixed" | "no_data";
  below_visa_days: number;
  above_sales_days: number;
};

export function ZAnalysisBlock({
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
  const { data, isLoading } = trpc.analytics.zAnalysis.useQuery({
    brand_id: brandId || undefined,
    store_id: storeId || undefined,
    year,
    month,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <ChartSkeleton height={220} />
        <ChartSkeleton height={300} />
        <ChartSkeleton height={280} />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      <HeroCard data={data} />
      <StoreTable stores={data.by_store} />
      <MonthlyTrendCard data={data} />
      <CompositionCard stores={data.by_store} />
    </div>
  );
}

// ───── Hero ─────
function HeroCard({
  data,
}: {
  data: ZData;
}) {
  const animated = useCountUp(data.total_combined, 900);
  const zOverVisaPct = data.z_over_visa_ratio * 100;
  // Compliance health: ≥105% sağlıklı, 100-105% sınırda, <100% riskli
  const overVisaTone =
    zOverVisaPct >= 105
      ? "text-emerald-700"
      : zOverVisaPct >= 100
        ? "text-amber-700"
        : "text-rose-700";

  return (
    <Card className="overflow-hidden animate-fade-in">
      <CardContent className="p-0">
        <div className="grid grid-cols-1 lg:grid-cols-5">
          {/* SOL: Toplam Z */}
          <div className="lg:col-span-3 px-6 py-8 lg:py-10">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-2">
              <ScrollText className="h-3.5 w-3.5" />
              {data.period_label} · Toplam Z
            </div>
            <div className="mt-3 text-4xl lg:text-5xl font-semibold tabular-nums tracking-tight text-foreground">
              {fmt(animated)}
              <span className="text-xl font-normal text-muted-foreground ml-2">
                ₺
              </span>
            </div>

            {/* Kompozisyon barı */}
            <div className="mt-5">
              <div className="flex items-center text-xs gap-3 mb-1.5 text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-3 rounded-sm"
                    style={{ backgroundColor: Z_COLOR }}
                  />
                  Z Raporu
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-3 rounded-sm"
                    style={{ backgroundColor: INVOICE_COLOR }}
                  />
                  El Faturası
                </span>
              </div>
              <div className="h-3 rounded-full overflow-hidden bg-muted/30 flex">
                {data.total_combined > 0 ? (
                  <>
                    <div
                      style={{
                        width: `${(data.total_z_report / data.total_combined) * 100}%`,
                        backgroundColor: Z_COLOR,
                      }}
                    />
                    <div
                      style={{
                        width: `${(data.total_manual_invoice / data.total_combined) * 100}%`,
                        backgroundColor: INVOICE_COLOR,
                      }}
                    />
                  </>
                ) : null}
              </div>
              <div className="mt-1 flex justify-between text-xs tabular-nums">
                <span className="text-foreground/80">
                  Z: <span className="font-semibold">{fmtShort(data.total_z_report)} ₺</span>
                </span>
                <span className="text-foreground/80">
                  El Fat.: <span className="font-semibold">{fmtShort(data.total_manual_invoice)} ₺</span>
                  {data.manual_invoice_share > 0 ? (
                    <span className="text-muted-foreground ml-1">
                      (%{(data.manual_invoice_share * 100).toFixed(1)})
                    </span>
                  ) : null}
                </span>
              </div>
            </div>
          </div>

          {/* SAĞ: Compliance metrikleri */}
          <div className="lg:col-span-2 border-t lg:border-t-0 lg:border-l border-border/60 bg-muted/10 px-5 py-6 lg:py-8">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">
              Uygunluk Özeti
            </div>
            <div className="space-y-3">
              <RatioRow
                label="Z / Visa"
                value={`%${zOverVisaPct.toFixed(1)}`}
                tone={overVisaTone}
                hint="alt sınır %100, nakit varsa %105"
              />
              <RatioRow
                label="Z / Toplam Satış"
                value={`%${(data.z_over_sales_ratio * 100).toFixed(1)}`}
                tone={
                  data.z_over_sales_ratio <= 1.001
                    ? "text-emerald-700"
                    : "text-rose-700"
                }
                hint="üst sınır %100"
              />
              <div className="pt-3 border-t border-border/40">
                <ComplianceStat data={data} />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RatioRow({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-lg font-semibold tabular-nums ${tone}`}>
          {value}
        </span>
      </div>
      {hint ? <div className="text-[10px] text-muted-foreground/80">{hint}</div> : null}
    </div>
  );
}

function ComplianceStat({ data }: { data: ZData }) {
  const total = data.by_store.length;
  return (
    <div className="text-xs space-y-1.5">
      <div className="text-muted-foreground uppercase tracking-wider font-medium mb-1.5">
        Mağazalar ({total})
      </div>
      <ComplianceLine
        icon={<Check className="h-3.5 w-3.5 text-emerald-600" />}
        label="Kurala uygun"
        count={data.stores_passed}
      />
      <ComplianceLine
        icon={<AlertTriangle className="h-3.5 w-3.5 text-rose-600" />}
        label="Visa altı (Z < Visa)"
        count={data.stores_below_visa}
      />
      <ComplianceLine
        icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
        label="Satış üstü"
        count={data.stores_above_sales}
      />
      {data.stores_no_data > 0 ? (
        <ComplianceLine
          icon={<FileText className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Veri yok"
          count={data.stores_no_data}
        />
      ) : null}
    </div>
  );
}

function ComplianceLine({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-foreground/80">
        {icon}
        {label}
      </span>
      <span className="tabular-nums font-semibold">{count}</span>
    </div>
  );
}

type ZData = ZAnalysisSummary;

// ───── Per-store table (accountant style) ─────
function StoreTable({ stores }: { stores: Store[] }) {
  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5 lg:p-6">
        <div className="font-semibold flex items-center gap-2 mb-1">
          <Receipt className="h-4 w-4 text-sky-600" />
          Mağaza Bazında Z Tablosu
        </div>
        <div className="text-xs text-muted-foreground mb-4">
          Toplam Z = Z Raporu + El Faturası. Alt sınır Visa, nakit varsa
          Visa×1.05. Üst sınır toplam satış.
        </div>
        <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                <th className="text-left font-medium py-2 pr-2">Mağaza</th>
                <th className="text-right font-medium py-2 px-2">Z Raporu</th>
                <th className="text-right font-medium py-2 px-2">El Faturası</th>
                <th className="text-right font-medium py-2 px-2">Toplam Z</th>
                <th className="text-right font-medium py-2 px-2">Visa</th>
                <th className="text-right font-medium py-2 px-2">Z/Visa</th>
                <th className="text-right font-medium py-2 px-2">Satış</th>
                <th className="text-right font-medium py-2 pl-2 w-32">Durum</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => (
                <StoreRow key={s.store_id} store={s} />
              ))}
              <TotalRow stores={stores} />
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function StoreRow({ store }: { store: Store }) {
  const [open, setOpen] = useState(false);
  const ratio = store.visa_total > 0 ? store.combined / store.visa_total : null;
  const hasData = store.days.length > 0;
  const complianceBadge = getComplianceBadge(store.compliance);
  return (
    <>
      <tr
        className={`border-b border-border/40 ${
          hasData ? "hover:bg-muted/30 cursor-pointer" : ""
        }`}
        onClick={() => hasData && setOpen(!open)}
      >
        <td className="py-3 pr-2">
          <div className="flex items-center gap-2">
            {hasData ? (
              open ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )
            ) : (
              <div className="w-3.5" />
            )}
            <div>
              <div className="font-medium text-foreground">{store.store_name}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {store.brand_name}
              </div>
            </div>
          </div>
        </td>
        <td className="py-3 px-2 text-right tabular-nums text-foreground/80">
          {store.z_report_total > 0 ? fmtShort(store.z_report_total) : "—"}
        </td>
        <td className="py-3 px-2 text-right tabular-nums">
          {store.manual_invoice_total > 0 ? (
            <span className="text-purple-700">{fmtShort(store.manual_invoice_total)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="py-3 px-2 text-right tabular-nums font-semibold text-foreground">
          {store.combined > 0 ? fmtShort(store.combined) : "—"}
        </td>
        <td className="py-3 px-2 text-right tabular-nums text-muted-foreground">
          {store.visa_total > 0 ? fmtShort(store.visa_total) : "—"}
        </td>
        <td className="py-3 px-2 text-right tabular-nums">
          {ratio !== null ? (
            <span
              className={
                ratio >= 1.05
                  ? "text-emerald-700"
                  : ratio >= 1.0
                    ? "text-amber-700"
                    : "text-rose-700 font-semibold"
              }
            >
              %{(ratio * 100).toFixed(1)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="py-3 px-2 text-right tabular-nums text-muted-foreground">
          {store.sales_total > 0 ? fmtShort(store.sales_total) : "—"}
        </td>
        <td className="py-3 pl-2 text-right">{complianceBadge}</td>
      </tr>
      {open && hasData ? (
        <tr>
          <td colSpan={8} className="bg-muted/15 p-0">
            <StoreDayDetails days={store.days} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function TotalRow({ stores }: { stores: Store[] }) {
  const t = stores.reduce(
    (acc, s) => ({
      z: acc.z + s.z_report_total,
      m: acc.m + s.manual_invoice_total,
      visa: acc.visa + s.visa_total,
      sales: acc.sales + s.sales_total,
    }),
    { z: 0, m: 0, visa: 0, sales: 0 }
  );
  const combined = t.z + t.m;
  const ratio = t.visa > 0 ? combined / t.visa : null;
  return (
    <tr className="border-t-2 border-border bg-slate-50/60">
      <td className="py-3 pr-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium pl-5">
          Toplam
        </div>
      </td>
      <td className="py-3 px-2 text-right tabular-nums font-semibold">
        {fmtShort(t.z)}
      </td>
      <td className="py-3 px-2 text-right tabular-nums font-semibold text-purple-700">
        {fmtShort(t.m)}
      </td>
      <td className="py-3 px-2 text-right tabular-nums font-bold">
        {fmtShort(combined)}
      </td>
      <td className="py-3 px-2 text-right tabular-nums font-semibold">
        {fmtShort(t.visa)}
      </td>
      <td className="py-3 px-2 text-right tabular-nums font-semibold">
        {ratio !== null ? `%${(ratio * 100).toFixed(1)}` : "—"}
      </td>
      <td className="py-3 px-2 text-right tabular-nums font-semibold">
        {fmtShort(t.sales)}
      </td>
      <td className="py-3 pl-2"></td>
    </tr>
  );
}

function getComplianceBadge(c: Store["compliance"]) {
  if (c === "passed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
        <Check className="h-3 w-3" />
        Uygun
      </span>
    );
  }
  if (c === "below_visa") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
        <AlertTriangle className="h-3 w-3" />
        Visa Altı
      </span>
    );
  }
  if (c === "above_sales") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
        <AlertTriangle className="h-3 w-3" />
        Satış Üstü
      </span>
    );
  }
  if (c === "mixed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
        <AlertTriangle className="h-3 w-3" />
        Karışık
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground border border-border">
      Veri Yok
    </span>
  );
}

function StoreDayDetails({ days }: { days: Store["days"] }) {
  return (
    <div className="px-5 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
        Günlük Z Detayı
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            <th className="text-left py-1.5 pr-2">Tarih</th>
            <th className="text-right py-1.5 px-2">Z Rap.</th>
            <th className="text-right py-1.5 px-2">El Fat.</th>
            <th className="text-right py-1.5 px-2">Toplam Z</th>
            <th className="text-right py-1.5 px-2">Visa</th>
            <th className="text-right py-1.5 px-2">Satış</th>
            <th className="text-right py-1.5 pl-2 w-24">Durum</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date} className="border-t border-border/40">
              <td className="py-1.5 pr-2 tabular-nums text-muted-foreground">
                {new Date(d.date).toLocaleDateString("tr-TR", {
                  day: "2-digit",
                  month: "short",
                })}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums">
                {d.z_report_total > 0 ? fmtShort(d.z_report_total) : "—"}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums">
                {d.manual_invoice_total > 0 ? (
                  <span className="text-purple-700">
                    {fmtShort(d.manual_invoice_total)}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums font-semibold">
                {d.combined > 0 ? fmtShort(d.combined) : "—"}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                {d.visa_total > 0 ? fmtShort(d.visa_total) : "—"}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                {d.sales_total > 0 ? fmtShort(d.sales_total) : "—"}
              </td>
              <td className="py-1.5 pl-2 text-right">
                <ComplianceMini c={d.compliance} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComplianceMini({ c }: { c: Store["days"][number]["compliance"] }) {
  if (c === "passed") return <Check className="inline h-3.5 w-3.5 text-emerald-600" />;
  if (c === "below_visa")
    return <span className="text-rose-700 text-[10px] font-medium">VİSA ALTI</span>;
  if (c === "above_sales")
    return <span className="text-amber-700 text-[10px] font-medium">SATIŞ ÜSTÜ</span>;
  return <span className="text-muted-foreground/70 text-[10px]">—</span>;
}

// ───── Monthly Trend ─────
function MonthlyTrendCard({ data }: { data: ZData }) {
  const series = data.monthly_trend.map((m) => ({
    label: m.label,
    z_report: m.z_report,
    manual_invoice: m.manual_invoice,
    combined: m.combined,
    visa: m.visa,
  }));
  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5 lg:p-6">
        <div className="font-semibold flex items-center gap-2 mb-1">
          <ScrollText className="h-4 w-4 text-sky-600" />
          Aylık Trend — Son 12 Ay
        </div>
        <div className="text-xs text-muted-foreground mb-4">
          Toplam Z (Z Raporu + El Faturası) ve Visa karşılaştırması
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="zArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={Z_COLOR} stopOpacity={0.25} />
                <stop offset="100%" stopColor={Z_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} interval={0} />
            <YAxis
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${TRY0.format(v / 1000)}K`}
              width={48}
            />
            <Tooltip
              formatter={(v, name) => {
                if (name === "combined") return [`${fmt(Number(v))} ₺`, "Toplam Z"];
                if (name === "z_report") return [`${fmt(Number(v))} ₺`, "Z Raporu"];
                if (name === "manual_invoice")
                  return [`${fmt(Number(v))} ₺`, "El Faturası"];
                if (name === "visa") return [`${fmt(Number(v))} ₺`, "Visa"];
                return [v, name];
              }}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
              formatter={(name) => {
                if (name === "combined") return "Toplam Z";
                if (name === "visa") return "Visa (alt sınır)";
                return String(name);
              }}
            />
            <Area
              type="monotone"
              dataKey="combined"
              stroke={Z_COLOR}
              strokeWidth={2.5}
              fill="url(#zArea)"
            />
            <Line
              type="monotone"
              dataKey="visa"
              stroke={VISA_COLOR}
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ───── Z Raporu vs El Faturası Composition ─────
function CompositionCard({ stores }: { stores: Store[] }) {
  const data = stores
    .filter((s) => s.combined > 0)
    .map((s) => ({
      store: s.store_name,
      brand: s.brand_name,
      z_report: s.z_report_total,
      manual_invoice: s.manual_invoice_total,
      total: s.combined,
      pct_manual:
        s.combined > 0 ? (s.manual_invoice_total / s.combined) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  if (data.length === 0) {
    return null;
  }

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5 lg:p-6">
        <div className="font-semibold flex items-center gap-2 mb-1">
          <FileText className="h-4 w-4 text-purple-600" />
          Z Raporu vs El Faturası
        </div>
        <div className="text-xs text-muted-foreground mb-4">
          Hangi mağaza ne kadar el faturası kullanıyor — mor: el faturası, mavi: Z fişi
        </div>
        <ResponsiveContainer width="100%" height={Math.max(180, data.length * 50)}>
          <BarChart data={data} layout="vertical" margin={{ left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis
              type="number"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${TRY0.format(v / 1000)}K`}
            />
            <YAxis
              type="category"
              dataKey="store"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={120}
            />
            <Tooltip
              formatter={(v, name) => {
                if (name === "z_report") return [`${fmt(Number(v))} ₺`, "Z Raporu"];
                if (name === "manual_invoice")
                  return [`${fmt(Number(v))} ₺`, "El Faturası"];
                return [v, name];
              }}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
              formatter={(name) =>
                name === "z_report" ? "Z Raporu" : "El Faturası"
              }
            />
            <Bar dataKey="z_report" stackId="a" fill={Z_COLOR}>
              {data.map((_, i) => (
                <Cell key={i} />
              ))}
            </Bar>
            <Bar
              dataKey="manual_invoice"
              stackId="a"
              fill={INVOICE_COLOR}
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>

        {/* Per-store manual share table */}
        <div className="mt-4 pt-4 border-t border-border/40">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
            El Faturası Payı
          </div>
          <div className="space-y-2">
            {data.map((s) => (
              <div
                key={s.store}
                className="flex items-baseline justify-between text-xs"
              >
                <span className="text-foreground">{s.store}</span>
                <div className="flex items-baseline gap-3">
                  <span className="tabular-nums text-muted-foreground">
                    {fmtShort(s.manual_invoice)} ₺ / {fmtShort(s.total)} ₺
                  </span>
                  <span
                    className={`tabular-nums font-semibold w-12 text-right ${
                      s.pct_manual >= 30
                        ? "text-rose-700"
                        : s.pct_manual >= 15
                          ? "text-amber-700"
                          : "text-foreground/80"
                    }`}
                  >
                    %{s.pct_manual.toFixed(1)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
