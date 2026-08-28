"use client";

import { useEffect, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import {
  Loader2,
  Users,
  Crown,
  ChevronDown,
  ChevronUp,
  Store as StoreIcon,
  CreditCard,
  Search,
  X,
  UserMinus,
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
  const { data, isLoading, isFetching } = trpc.nebimSales.customers.useQuery(
    input,
    // Arama harfi başına sorgu yenilenir; önceki sonucu ekranda tutmazsak
    // bölüm unmount olup yükleniyor kartına düşer ve sayfa başa sıçrar.
    { placeholderData: keepPreviousData }
  );
  // Yalnız ilk yüklemede tam ekran gösterge; aramada liste yerinde kalır.
  const searching = isFetching && !isLoading;
  const exportMutation = trpc.nebimSales.exportCustomers.useMutation();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      {/* Sayfa aksiyonu — dönem/mağaza üstteki Filtreler'den, arama tabloda */}
      <div className="flex items-center justify-end">
        <ExportExcelButton onExport={() => exportMutation.mutateAsync(input)} />
      </div>

      {isLoading || !data ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
            Müşteri analizi hesaplanıyor…
          </CardContent>
        </Card>
      ) : data.rows.length === 0 && !search ? (
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
          <div className="mb-2 text-right text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Tutarlar KDV hariç
          </div>

          {/* Özet şerit — tek kart, ince bölmeler, sakin tipografi */}
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-border/50">
                <StatCell
                  label="Müşteri"
                  value={String(data.kpi.customers)}
                  delta={deltaPct(data.kpi.customers, data.prev?.customers)}
                />
                <StatCell
                  label="Ciro"
                  value={intTL(data.kpi.net_total)}
                  delta={deltaPct(data.kpi.net_total, data.prev?.net_total)}
                />
                <StatCell
                  label="Yeni Müşteri"
                  value={
                    data.kpi.new_applicable
                      ? String(data.kpi.new_customers)
                      : "—"
                  }
                  sub={
                    data.kpi.new_applicable
                      ? data.kpi.customers
                        ? `müşterilerin %${((data.kpi.new_customers / data.kpi.customers) * 100).toFixed(0)}'i`
                        : "ilk alışverişi bu dönemde"
                      : "aylık trend aşağıda"
                  }
                />
                <StatCell
                  label="Tekrar Eden"
                  value={`%${data.kpi.repeat_pct.toFixed(1)}`}
                  sub="2+ fişli müşteri oranı"
                />
                <StatCell
                  label="Ort. Harcama"
                  value={intTL(data.kpi.avg_spend)}
                  delta={deltaPct(data.kpi.avg_spend, data.prev?.avg_spend)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Yeni müşteri trendi — piksel-kesin sütunlar, tek mürekkep tonu */}
          {data.monthly.length > 0 ? (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="px-5 py-4 border-b border-border/50 flex items-baseline justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em]">
                      Yeni Müşteri Trendi
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted-foreground">
                      Ayın müşterileri içinde ilk kez gelenlerin payı
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-[2px] bg-foreground" />
                      Yeni
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-[2px] bg-muted-foreground/25" />
                      Geri gelen
                    </span>
                  </div>
                </div>
                <div className="px-5 py-6 overflow-x-auto">
                  {(() => {
                    const maxA = Math.max(...data.monthly.map((x) => x.active), 1);
                    const BAR = 140; // px — yüzde yerine piksel: her zaman doğru çizer
                    return (
                      <>
                        <div
                          className="flex items-end gap-3 min-w-[560px] border-b border-border/70"
                          style={{ height: BAR + 28 }}
                        >
                          {data.monthly.map((m) => {
                            const total = Math.max(
                              Math.round((m.active / maxA) * BAR), 3
                            );
                            const newH = Math.round(
                              total * (m.active > 0 ? m.new_customers / m.active : 0)
                            );
                            return (
                              <div
                                key={m.month}
                                className="flex-1 flex flex-col items-center justify-end gap-1.5"
                                title={`${fmtMonth(m.month)} · ${m.active} müşteri · ${m.new_customers} yeni (%${m.new_pct.toFixed(0)})`}
                              >
                                <span className="text-[11px] font-semibold tabular-nums">
                                  %{m.new_pct.toFixed(0)}
                                </span>
                                <div
                                  className="w-full max-w-[36px] flex flex-col justify-end rounded-t-[3px] overflow-hidden"
                                  style={{ height: total }}
                                >
                                  <div
                                    className="w-full bg-muted-foreground/25"
                                    style={{ height: total - newH }}
                                  />
                                  <div
                                    className="w-full bg-foreground"
                                    style={{ height: newH }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex gap-3 min-w-[560px] mt-2">
                          {data.monthly.map((m) => (
                            <div key={m.month} className="flex-1 text-center">
                              <div className="text-[11px] tabular-nums text-foreground/80">
                                {m.active}
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                {fmtMonth(m.month)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                  <p className="text-[11px] text-muted-foreground mt-4 leading-relaxed max-w-3xl">
                    Koyu kısım o ay ilk kez gelen müşteri; oran düştükçe geri
                    gelen müşteri tabanı büyüyor demektir. Veri Ocak
                    2026&apos;da başladığı için ilk ay doğal olarak %100
                    görünür.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Sadakat piramidi + konsantrasyon — tek renk, ince çizgi */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2 overflow-hidden">
              <CardContent className="p-0">
                <div className="px-5 py-4 border-b border-border/50 flex items-baseline justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
                    Sadakat Piramidi
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    dönem harcamasına göre bant · ciro payı
                  </span>
                </div>
                <div className="px-5 py-4 space-y-3">
                  {data.tiers.map((t) => (
                    <div key={t.key} className="flex items-center gap-4">
                      <span className="w-14 shrink-0 text-xs font-medium">
                        {t.label}
                      </span>
                      <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                        {t.count} kişi
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-foreground/75"
                          style={{ width: `${Math.min(t.share_pct, 100)}%` }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right text-xs tabular-nums font-semibold">
                        {intTL(t.net)}
                      </span>
                      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                        %{t.share_pct.toFixed(1)}
                      </span>
                      <span className="w-20 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums hidden sm:block">
                        ort. {intTL(t.avg)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="px-5 py-4 border-b border-border/50">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
                    Ciro Konsantrasyonu
                  </span>
                </div>
                <div className="px-5 py-4 space-y-4">
                  {(
                    [
                      ["İlk 10 müşteri", data.concentration.top10],
                      ["İlk 50 müşteri", data.concentration.top50],
                      ["İlk 100 müşteri", data.concentration.top100],
                    ] as Array<[string, number]>
                  ).map(([label, v]) => (
                    <div key={label}>
                      <div className="flex items-baseline justify-between mb-1.5">
                        <span className="text-xs text-muted-foreground">{label}</span>
                        <span className="text-sm font-semibold tabular-nums">
                          %{v.toFixed(1)}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-foreground/75"
                          style={{ width: `${Math.min(v, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground pt-1 leading-relaxed">
                    Cironun ne kadarı en çok harcayan müşterilerden geliyor —
                    yüksek oran, az sayıda müşteriye bağımlılık demektir.
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
              <div className="px-4 py-3 border-b border-border/50 flex items-center gap-3 flex-wrap">
                <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Crown className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm">
                    En Çok Alışveriş Yapan Müşteriler
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {search
                      ? `"${search}" için ${data.total_customers} sonuç`
                      : `net harcamaya göre · top ${data.rows.length}${
                          data.total_customers > data.rows.length
                            ? ` / ${data.total_customers}`
                            : ""
                        }`}
                  </div>
                </div>
                {/* Arama — bu tablonun filtresi, o yüzden burada */}
                <div className="relative ml-auto w-full sm:w-72">
                  {searching ? (
                    <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  )}
                  <Input
                    value={searchRaw}
                    onChange={(e) => setSearchRaw(e.target.value)}
                    placeholder="Müşteri adı veya kodu ara…"
                    className="pl-9 pr-9 h-9"
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
              </div>
              <div
                className={`overflow-x-auto transition-opacity ${
                  searching ? "opacity-60" : ""
                }`}
              >
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
                    {data.rows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                          <div className="font-medium text-foreground">
                            &quot;{search}&quot; için bu dönemde müşteri bulunamadı
                          </div>
                          <div className="text-sm mt-1">
                            Müşterinin bu dönemde alışverişi olmayabilir — üstteki
                            Dönem&apos;den &quot;Tüm Zaman&quot; seçip tüm geçmişte ara.
                          </div>
                        </td>
                      </tr>
                    ) : null}
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

/** Sakin istatistik hücresi — ikon yok, tipografi hiyerarşisi konuşur. */
function StatCell({
  label,
  value,
  sub,
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
}) {
  return (
    <div className="px-5 py-4">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </div>
      {delta != null ? (
        <div
          className={`mt-1 text-[11px] tabular-nums ${
            delta >= 0 ? "text-emerald-600" : "text-rose-500"
          }`}
        >
          {delta >= 0 ? "↑" : "↓"} %{Math.abs(delta).toFixed(1).replace(".", ",")}
          <span className="text-muted-foreground"> önceki dönem</span>
        </div>
      ) : sub ? (
        <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}
