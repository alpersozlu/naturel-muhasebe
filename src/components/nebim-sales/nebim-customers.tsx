"use client";

import { useEffect, useState } from "react";
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
  Search,
  X,
  PieChart,
  UserMinus,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

const TIER_BAR: Record<string, string> = {
  vip: "bg-violet-500",
  gold: "bg-amber-500",
  silver: "bg-slate-400",
  bronze: "bg-orange-400",
  none: "bg-slate-300",
};

/** Geçen döneme göre değişim (%). Önceki dönem yoksa/sıfırsa null. */
function deltaPct(cur: number, prev: number | undefined): number | null {
  if (prev == null || prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

export function NebimCustomers({
  filters,
}: {
  filters: NebimSalesSelection;
}) {
  // Müşteri arama — 300ms debounce ile sunucuda (isim TR-katlamalı + kod).
  const [searchRaw, setSearchRaw] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchRaw.trim()), 300);
    return () => clearTimeout(t);
  }, [searchRaw]);

  const input = {
    store_id: filters.storeId || undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
    search: search || undefined,
  };
  const { data, isLoading } = trpc.nebimSales.customers.useQuery(input);
  const exportMutation = trpc.nebimSales.exportCustomers.useMutation();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      {/* Müşteri ara + Excel (dönem/mağaza üstteki Filtreler'den) */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
            placeholder="Müşteri adı veya kodu ara… (örn. Fatih, 1-4-21648)"
            className="pl-9 pr-9 h-10"
          />
          {searchRaw ? (
            <button
              type="button"
              onClick={() => setSearchRaw("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
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
            {search ? (
              <>
                <div className="font-medium text-foreground">
                  &quot;{search}&quot; için bu dönemde müşteri bulunamadı
                </div>
                <div className="text-sm mt-1">
                  Müşterinin bu dönemde alışverişi olmayabilir — üstteki
                  Dönem&apos;den &quot;Özel aralık → Tüm Zaman&quot; seçip tüm
                  geçmişte ara.
                </div>
              </>
            ) : (
              <div className="font-medium text-foreground">
                Bu dönemde isimli müşteri satışı yok
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI şeridi — geçen dönemle kıyaslı */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi
              icon={Users}
              label="Müşteri"
              value={String(data.kpi.customers)}
              delta={deltaPct(data.kpi.customers, data.prev?.customers)}
            />
            <Kpi
              icon={Wallet}
              label="Müşteri Cirosu"
              value={intTL(data.kpi.net_total)}
              accent="text-indigo-700"
              delta={deltaPct(data.kpi.net_total, data.prev?.net_total)}
            />
            <Kpi
              icon={UserPlus}
              label="Yeni Müşteri"
              value={
                data.kpi.new_applicable ? String(data.kpi.new_customers) : "—"
              }
              accent="text-emerald-600"
              sub={
                data.kpi.new_applicable
                  ? data.kpi.customers
                    ? `müşterilerin %${((data.kpi.new_customers / data.kpi.customers) * 100).toFixed(0)}'i · ilk alışverişi bu dönemde`
                    : "ilk alışverişi bu dönemde"
                  : "tüm zamanda ölçülmez — aylık trend aşağıda"
              }
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
              delta={deltaPct(data.kpi.avg_spend, data.prev?.avg_spend)}
            />
          </div>

          {/* Aylık yeni müşteri trendi — dikkat çekici ana grafik */}
          {data.monthly.length > 0 ? (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2 flex-wrap">
                  <div className="h-7 w-7 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                    <UserPlus className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm">Yeni Müşteri Trendi</div>
                    <div className="text-[11px] text-muted-foreground">
                      Her ay kaç müşteri ilk kez alışveriş yaptı ve o ayın
                      müşterilerinin yüzde kaçı yeni
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-3 text-[11px]">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                      Yeni müşteri
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />
                      Geri gelen
                    </span>
                  </div>
                </div>
                <div className="p-4 overflow-x-auto">
                  <div className="flex items-end gap-2 min-w-[560px] h-44">
                    {data.monthly.map((m) => {
                      const maxA = Math.max(...data.monthly.map((x) => x.active), 1);
                      const h = (m.active / maxA) * 100;
                      const newH = m.active > 0 ? (m.new_customers / m.active) * 100 : 0;
                      const hot = m.new_pct >= 60;
                      return (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                          <span
                            className={`text-[11px] font-bold tabular-nums ${
                              hot ? "text-emerald-700" : "text-muted-foreground"
                            }`}
                          >
                            %{m.new_pct.toFixed(0)}
                          </span>
                          <div
                            className="w-full rounded-t-md bg-slate-200 relative flex flex-col justify-end overflow-hidden"
                            style={{ height: `${Math.max(h, 4)}%` }}
                            title={`${fmtMonth(m.month)}: ${m.active} müşteri · ${m.new_customers} yeni`}
                          >
                            <div
                              className="w-full bg-emerald-500"
                              style={{ height: `${newH}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {m.active}
                          </span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {fmtMonth(m.month)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
                    Çubuk yüksekliği o ayın toplam müşterisi; yeşil kısım ilk kez
                    gelenler. Oran düştükçe geri gelen müşteri tabanınız büyüyor
                    demektir. Not: veri Ocak 2026&apos;da başladığı için ilk ay
                    doğal olarak %100 görünür.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Sadakat piramidi + konsantrasyon */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2 overflow-hidden">
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-violet-500/10 text-violet-600 flex items-center justify-center">
                    <Crown className="h-4 w-4" />
                  </div>
                  <span className="font-semibold text-sm">Sadakat Piramidi</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    dönem harcamasına göre bant · ciro payı
                  </span>
                </div>
                <div className="p-4 space-y-2.5">
                  {data.tiers.map((t) => (
                    <div key={t.key} className="flex items-center gap-3">
                      <span
                        className={`w-16 shrink-0 text-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          TIER_STYLE[t.key]?.cls ??
                          "bg-slate-50 text-slate-600 border-slate-200"
                        }`}
                      >
                        {t.label}
                      </span>
                      <span className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">
                        {t.count} kişi
                      </span>
                      <div className="flex-1 h-2.5 rounded-full bg-muted/60 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${TIER_BAR[t.key] ?? "bg-slate-400"}`}
                          style={{ width: `${Math.min(t.share_pct, 100)}%` }}
                        />
                      </div>
                      <span className="w-28 shrink-0 text-right text-xs tabular-nums font-semibold">
                        {intTL(t.net)}
                      </span>
                      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        %{t.share_pct.toFixed(1)}
                      </span>
                      <span className="w-24 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums hidden sm:block">
                        ort. {intTL(t.avg)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
                    <PieChart className="h-4 w-4" />
                  </div>
                  <span className="font-semibold text-sm">Ciro Konsantrasyonu</span>
                </div>
                <div className="p-4 space-y-3">
                  {(
                    [
                      ["İlk 10 müşteri", data.concentration.top10],
                      ["İlk 50 müşteri", data.concentration.top50],
                      ["İlk 100 müşteri", data.concentration.top100],
                    ] as Array<[string, number]>
                  ).map(([label, v]) => (
                    <div key={label}>
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-xs text-muted-foreground">{label}</span>
                        <span className="text-sm font-bold tabular-nums">
                          %{v.toFixed(1)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${Math.min(v, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground pt-1 leading-relaxed">
                    Cironun ne kadarı en çok harcayan müşterilerden geliyor.
                    Yüksek oran = az sayıda müşteriye bağımlılık.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Geri kazanılacaklar — uykuda değerli müşteriler */}
          {data.dormant.length > 0 ? (
            <Card className="overflow-hidden border-amber-200">
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b border-amber-200/70 bg-amber-50/50 flex items-start gap-2 flex-wrap">
                  <div className="h-7 w-7 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
                    <UserMinus className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-amber-900">
                      Geri Kazanılacaklar — Uykuda Değerli Müşteriler
                    </div>
                    <div className="text-[11px] text-amber-800/70">
                      Toplam ₺25.000+ harcamış ama 90+ gündür alışveriş yapmamış
                      müşteriler (tüm geçmiş) — aranacaklar listesi
                    </div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-lg font-bold tabular-nums text-amber-700">
                      {data.dormant.length}
                    </div>
                    <div className="text-[11px] text-amber-800/70">müşteri</div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="text-left font-medium px-4 py-2">Müşteri</th>
                        <th className="text-right font-medium px-4 py-2">
                          Toplam Harcama
                        </th>
                        <th className="text-right font-medium px-4 py-2">Fiş</th>
                        <th className="text-left font-medium px-4 py-2">
                          Son Alışveriş
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.dormant.map((d) => (
                        <tr
                          key={`${d.code ?? ""}|${d.name}`}
                          className="border-t border-border/40 hover:bg-amber-50/40"
                        >
                          <td className="px-4 py-2">
                            <div className="font-medium">{d.name}</div>
                            {d.code ? (
                              <div className="text-[10px] text-muted-foreground">
                                {d.code}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold">
                            {fmt(d.lifetime_net)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                            {d.invoices}
                          </td>
                          <td className="px-4 py-2">
                            <span className="tabular-nums">{fmtDate(d.last_date)}</span>
                            <span className="ml-2 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-semibold">
                              {d.days_since} gün önce
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : null}

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
  delta,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  /** Geçen döneme göre % değişim — ok + etiketle gösterilir (renk tek başına değil). */
  delta?: number | null;
}) {
  const up = delta != null && delta >= 0;
  const DeltaIcon = up ? TrendingUp : TrendingDown;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className={`mt-1 text-xl font-bold tabular-nums ${accent ?? ""}`}>{value}</div>
        {delta != null ? (
          <div
            className={`mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
            }`}
          >
            <DeltaIcon className="h-3 w-3" />
            {up ? "+" : ""}
            {delta.toFixed(1).replace(".", ",")}%
            <span className="font-normal opacity-70">geçen dönem</span>
          </div>
        ) : sub ? (
          <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
