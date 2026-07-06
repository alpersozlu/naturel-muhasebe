"use client";

import { useState } from "react";
import {
  Loader2,
  Users,
  UserPlus,
  Repeat,
  Wallet,
  Crown,
  ChevronDown,
  ChevronUp,
  Store as StoreIcon,
  CreditCard,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { ExportExcelButton } from "@/components/analytics/export-button";
import type { NebimSalesSelection } from "./nebim-filters";

const TRY = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const INT = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const fmt = (n: number) => `₺${TRY.format(n)}`;
const intTL = (n: number) => `₺${INT.format(Math.round(n))}`;

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

const MONTH_TR = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];
function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTH_TR[Number(m) - 1]} ${y}`;
}

// ── Sadakat rozetleri (backend LOYALTY_TIERS ile aynı eşikler) ──
const TIER_STYLE: Record<string, { label: string; cls: string }> = {
  vip: { label: "VIP", cls: "bg-violet-100 text-violet-700 border-violet-200" },
  gold: { label: "Altın", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  silver: { label: "Gümüş", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  bronze: { label: "Bronz", cls: "bg-orange-100 text-orange-700 border-orange-200" },
};

// ── Dönem kısayolları — sayfanın tarih filtresini SET eder (tüm sekmelerle senkron) ──
type PeriodKey = "thisMonth" | "lastMonth" | "thisYear" | "all";

function periodRange(key: PeriodKey): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  switch (key) {
    case "thisMonth":
      return { from: iso(new Date(y, m, 1)), to: iso(now) };
    case "lastMonth":
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "thisYear":
      return { from: `${y}-01-01`, to: iso(now) };
    case "all":
      return { from: "", to: "" };
  }
}

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "thisMonth", label: "Bu Ay" },
  { key: "lastMonth", label: "Geçen Ay" },
  { key: "thisYear", label: "Bu Yıl" },
  { key: "all", label: "Tüm Zaman" },
];

export function NebimCustomers({
  filters,
  onChange,
}: {
  filters: NebimSalesSelection;
  onChange: (s: NebimSalesSelection) => void;
}) {
  const input = {
    store_id: filters.storeId || undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
  };
  const { data, isLoading } = trpc.nebimSales.customers.useQuery(input);
  const exportMutation = trpc.nebimSales.exportCustomers.useMutation();
  const [expanded, setExpanded] = useState<string | null>(null);

  const activePeriod = PERIODS.find(({ key }) => {
    const r = periodRange(key);
    return r.from === filters.dateFrom && r.to === filters.dateTo;
  })?.key;

  return (
    <div className="space-y-5">
      {/* Dönem kısayolları + Excel */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-xl border border-border bg-muted/40 p-1">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                const r = periodRange(key);
                onChange({ ...filters, dateFrom: r.from, dateTo: r.to });
              }}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activePeriod === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <ExportExcelButton onExport={() => exportMutation.mutateAsync(input)} />
      </div>

      {isLoading || !data ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
            Müşteri analizi hesaplanıyor…
          </CardContent>
        </Card>
      ) : data.rows.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <div className="font-medium text-foreground">
              Bu dönemde isimli müşteri satışı yok
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI şeridi */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi icon={Users} label="Müşteri" value={String(data.kpi.customers)} />
            <Kpi
              icon={Wallet}
              label="Müşteri Cirosu"
              value={intTL(data.kpi.net_total)}
              accent="text-indigo-700"
            />
            <Kpi
              icon={UserPlus}
              label="Yeni Müşteri"
              value={String(data.kpi.new_customers)}
              accent="text-emerald-700"
              sub="ilk alışverişi bu dönemde"
            />
            <Kpi
              icon={Repeat}
              label="Tekrar Eden"
              value={`%${data.kpi.repeat_pct.toFixed(1)}`}
              sub="2+ fişli müşteri oranı"
            />
            <Kpi
              icon={Crown}
              label="Ort. Harcama"
              value={intTL(data.kpi.avg_spend)}
              accent="text-violet-700"
            />
          </div>

          {/* Top müşteriler tablosu */}
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <Crown className="h-4 w-4" />
                </div>
                <span className="font-semibold text-sm">En Çok Alışveriş Yapan Müşteriler</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  net harcamaya göre · top {data.rows.length}
                  {data.total_customers > data.rows.length
                    ? ` / ${data.total_customers}`
                    : ""}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-900 text-slate-100 text-[10px] uppercase tracking-wider">
                      <th className="text-left font-semibold px-3 py-2.5 w-10">#</th>
                      <th className="text-left font-semibold px-3 py-2.5">Müşteri</th>
                      <th className="text-left font-semibold px-3 py-2.5">Sadakat</th>
                      <th className="text-right font-semibold px-3 py-2.5">Net TL</th>
                      <th className="text-right font-semibold px-3 py-2.5">Fiş</th>
                      <th className="text-right font-semibold px-3 py-2.5">Adet</th>
                      <th className="text-right font-semibold px-3 py-2.5">Ort. Sepet</th>
                      <th className="text-right font-semibold px-3 py-2.5">Son Alışveriş</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r, i) => {
                      const k = `${r.code ?? ""}|${r.name}`;
                      const isOpen = expanded === k;
                      const tier = r.tier ? TIER_STYLE[r.tier] : null;
                      return (
                        <CustomerRow
                          key={k}
                          rank={i + 1}
                          r={r}
                          tier={tier}
                          isOpen={isOpen}
                          onToggle={() => setExpanded(isOpen ? null : k)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {data.kpi.anonymous_net > 0 || data.kpi.generic_count > 0 ? (
                <div className="px-4 py-2 border-t border-border/40 text-[11px] text-muted-foreground space-y-0.5">
                  {data.kpi.generic_count > 0 ? (
                    <div>
                      Not: {data.kpi.generic_count} jenerik/turist kartı
                      (&quot;YABANCI&quot; vb. — gerçek kişi değil) listeden hariç
                      tutuldu — dönem net&apos;i: {fmt(data.kpi.generic_net)}.
                    </div>
                  ) : null}
                  {data.kpi.anonymous_net > 0 ? (
                    <div>
                      İsimsiz (müşteri kaydı olmayan) satışlar bu listede yok —
                      dönem isimsiz net: {fmt(data.kpi.anonymous_net)}.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function CustomerRow({
  rank,
  r,
  tier,
  isOpen,
  onToggle,
}: {
  rank: number;
  r: {
    code: string | null;
    name: string;
    net: number;
    invoices: number;
    units: number;
    avg_basket: number;
    last_date: string;
    is_new: boolean;
  };
  tier: { label: string; cls: string } | null;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const rankCls =
    rank === 1
      ? "bg-amber-100 text-amber-800"
      : rank === 2
        ? "bg-slate-200 text-slate-700"
        : rank === 3
          ? "bg-orange-100 text-orange-800"
          : "bg-muted text-muted-foreground";
  return (
    <>
      <tr
        className="border-b border-border/40 hover:bg-muted/30 cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-3 py-2.5">
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${rankCls}`}
          >
            {rank}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <div className="font-medium">{r.name}</div>
          {r.code ? (
            <div className="text-[10px] text-muted-foreground">{r.code}</div>
          ) : null}
        </td>
        <td className="px-3 py-2.5">
          <span className="inline-flex items-center gap-1.5">
            {tier ? (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tier.cls}`}
              >
                {tier.label}
              </span>
            ) : null}
            {r.is_new ? (
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[10px] font-semibold">
                YENİ
              </span>
            ) : null}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
          {fmt(r.net)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">{r.invoices}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{r.units}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
          {intTL(r.avg_basket)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
          {fmtDate(r.last_date)}
        </td>
        <td className="px-3 py-2.5 text-muted-foreground">
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </td>
      </tr>
      {isOpen ? (
        <tr className="border-b border-border/40 bg-muted/20">
          <td colSpan={9} className="px-4 py-4">
            <CustomerDetail code={r.code} name={r.name} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function CustomerDetail({ code, name }: { code: string | null; name: string }) {
  const { data, isLoading } = trpc.nebimSales.customerDetail.useQuery({
    customer_code: code,
    customer_name: name,
  });

  if (isLoading || !data) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 mx-auto mb-1 animate-spin" />
        Müşteri geçmişi yükleniyor…
      </div>
    );
  }

  const months = data.monthly.slice(-12);
  const maxMonth = Math.max(...months.map((m) => Math.abs(m.net)), 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-sm">
      {/* Aylık harcama (tüm zaman, son 12 ay) */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Aylık Harcama (tüm geçmiş: {fmt(data.totals.net)} · {data.totals.invoices} fiş ·{" "}
          {fmtDate(data.totals.first_date)} → {fmtDate(data.totals.last_date)})
        </div>
        <div className="space-y-1">
          {months.map((m) => (
            <div key={m.month} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[11px] text-muted-foreground">
                {fmtMonth(m.month)}
              </span>
              <div className="flex-1 h-3 rounded bg-muted/60 overflow-hidden">
                <div
                  className="h-full rounded bg-indigo-500/70"
                  style={{ width: `${(Math.abs(m.net) / maxMonth) * 100}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right tabular-nums text-[11px]">
                {intTL(m.net)}
              </span>
              <span className="w-10 shrink-0 text-right text-[10px] text-muted-foreground">
                {m.invoices} fiş
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* En çok aldığı ürünler */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          En Çok Aldığı Ürünler
        </div>
        <div className="space-y-1.5">
          {data.top_products.map((p) => (
            <div key={p.desc} className="flex items-center justify-between gap-2">
              <span className="truncate">{p.desc}</span>
              <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
                {p.units} ad · {intTL(p.net)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Mağaza + ödeme + son alışverişler */}
      <div className="space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Mağaza / Ödeme
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.by_store.map((s) => (
              <span
                key={s.name}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]"
              >
                <StoreIcon className="h-3 w-3" /> {s.name} · {intTL(s.net)}
              </span>
            ))}
            {data.by_payment.map((p) => (
              <span
                key={p.label}
                className="inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 text-[11px]"
              >
                <CreditCard className="h-3 w-3" /> {p.label} · {intTL(p.net)}
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Son Alışverişler
          </div>
          <div className="space-y-1">
            {data.recent.map((l, i) => (
              <div key={`${l.ref}-${i}`} className="flex items-center gap-2 text-[11px]">
                <span className="w-16 shrink-0 tabular-nums text-muted-foreground">
                  {fmtDate(l.date)}
                </span>
                <span className="truncate flex-1">
                  {l.desc ?? "—"}
                  {l.is_return ? (
                    <span className="ml-1 text-rose-600 font-medium">(iade)</span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums">{intTL(l.net)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className={`mt-1 text-xl font-bold tabular-nums ${accent ?? ""}`}>{value}</div>
        {sub ? <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}
