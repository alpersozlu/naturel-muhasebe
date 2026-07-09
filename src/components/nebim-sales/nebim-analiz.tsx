"use client";

import { Loader2, Percent, Users, Tag, ShieldAlert, CheckCircle2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { NebimScorecard } from "./nebim-scorecard";
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

export function NebimAnaliz({
  filters,
  onChange,
}: {
  filters: NebimSalesSelection;
  onChange: (v: NebimSalesSelection) => void;
}) {
  const input = toInput(filters);
  const { data, isLoading } = trpc.nebimSales.analiz.useQuery(input);
  const staff = trpc.nebimSales.staffKpi.useQuery(input);
  // only_returns outlet için anlamsız — gönderme (outlet kendi iade mantığını kurar)
  const outlet = trpc.nebimSales.outlet.useQuery({
    store_id: input.store_id,
    date_from: input.date_from,
    date_to: input.date_to,
  });

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
      {/* Mağaza Karnesi — sunum kalitesinde mağaza kartları (hedef + tahmin).
          Karta tıklamak sayfa filtresindeki mağazayı seçer/kaldırır. */}
      <NebimScorecard filters={filters} onChange={onChange} />

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Net Toplam" value={fmt(data.kpi.net_total)} sub="iadeler dahil" />
        <Kpi
          label="İadeler"
          value={
            data.kpi.returns_total
              ? `−₺${TRY.format(Math.abs(data.kpi.returns_total))}`
              : "₺0,00"
          }
          sub={`${data.kpi.returns_count} iade satırı · net toplamdan düşülür`}
          accent
        />
        <Kpi label="Fiş Sayısı" value={String(data.kpi.invoices)} />
        <Kpi label="Satır Sayısı" value={String(data.kpi.lines)} />
      </div>

      {/* İndirim Analizi — orijinal fiyat → satılan fiyat → indirim % */}
      <IndirimAnaliz indirim={data.indirim} />

      {/* Outlet Geliri (ay × mağaza) + kural-dışı outlet satışları */}
      {outlet.data && outlet.data.months.length > 0 ? (
        <>
          <OutletGelir data={outlet.data} />
          <OutletBulgular data={outlet.data} />
        </>
      ) : null}

      {/* Çalışan Satış KPI */}
      {staff.data && staff.data.rows.length > 0 ? (
        <CalisanKpi data={staff.data} />
      ) : null}
    </div>
  );
}

type OutletData = {
  summary: {
    net_total: number; tx_count: number; discount_total: number;
    returns_total: number; returns_count: number; leak_loss: number;
    certain_tx: number; certain_net: number;
    probable_tx: number; probable_net: number;
  };
  stores: string[];
  months: Array<{
    month: string; label: string;
    cells: Record<string, { net: number; count: number }>;
    total: { net: number; count: number };
  }>;
  store_totals: Record<string, { net: number; count: number }>;
  leaks: Array<{
    date: string; store: string; ref: string; code: string | null;
    desc: string | null; price: number; sold: number; disc_pct: number;
    campaign: string | null; salesperson: string | null; stock_match: boolean;
  }>;
  girne: Array<{
    date: string; ref: string; code: string | null; desc: string | null;
    price: number; sold: number; disc_pct: number; overlap: boolean;
    stock_match: boolean;
  }>;
};

function fmtDateTr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function storeDot(name: string): string {
  const n = name.toLocaleLowerCase("tr").replace(/ı/g, "i");
  if (n.includes("lefkosa")) return "bg-blue-500";
  if (n.includes("girne")) return "bg-emerald-500";
  if (n.includes("magusa")) return "bg-amber-500";
  return "bg-slate-400";
}

function OutletGelir({ data }: { data: OutletData }) {
  const s = data.summary;
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b border-border/50 flex items-start gap-2 flex-wrap">
          <div className="h-7 w-7 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0">
            <Tag className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm">Outlet Geliri</div>
            <div className="text-[11px] text-muted-foreground">
              Outlet reyonu net cirosu — ay × mağaza (ayakkabı/terlik/sandalet, sabit fiyat)
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-lg font-bold tabular-nums">{fmt(s.net_total)}</div>
            <div className="text-[11px] text-muted-foreground">
              {s.tx_count} işlem · {fmt(s.discount_total)} iskonto verildi
              {s.returns_count > 0
                ? ` · ${s.returns_count} iade (${fmt(s.returns_total)})`
                : ""}
            </div>
            {s.certain_tx > 0 ? (
              <div className="text-[11px] mt-0.5">
                <span className="text-emerald-700 font-medium">
                  ✓ {s.certain_tx} sayım-doğrulamalı ({fmt(s.certain_net)})
                </span>
                <span className="text-muted-foreground">
                  {" "}· {s.probable_tx} muhtemel ({fmt(s.probable_net)})
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-100 text-[10px] uppercase tracking-wider">
                <th className="text-left font-semibold px-4 py-2.5">Ay</th>
                {data.stores.map((st) => (
                  <th key={st} className="text-right font-semibold px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${storeDot(st)}`} />
                      {st}
                    </span>
                  </th>
                ))}
                <th className="text-right font-semibold px-4 py-2.5">Toplam</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month} className="border-b border-border/40 hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-medium">{m.label}</td>
                  {data.stores.map((st) => {
                    const c = m.cells[st];
                    return (
                      <td key={st} className="px-4 py-2.5 text-right">
                        {c ? (
                          <>
                            <div className="tabular-nums font-semibold">{fmt(c.net)}</div>
                            <div className="text-[10px] text-muted-foreground">{c.count} işlem</div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold">{fmt(m.total.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-900 text-slate-100 font-semibold">
                <td className="px-4 py-2.5">TOPLAM</td>
                {data.stores.map((st) => {
                  const c = data.store_totals[st];
                  return (
                    <td key={st} className="px-4 py-2.5 text-right tabular-nums">
                      {c ? fmt(c.net) : "—"}
                    </td>
                  );
                })}
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(s.net_total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function OutletBulgular({ data }: { data: OutletData }) {
  const { leaks, girne, summary } = data;
  if (leaks.length === 0 && girne.length === 0) {
    return (
      <Card>
        <CardContent className="py-4 px-4 flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          Kural dışı outlet satışı bulunamadı — tüm indirimli outlet satışlarında yönetim izi var.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {leaks.length > 0 ? (
        <Card className="overflow-hidden border-rose-200">
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-rose-200/70 bg-rose-50/50 flex items-start gap-2 flex-wrap">
              <div className="h-7 w-7 rounded-lg bg-rose-500/10 text-rose-600 flex items-center justify-center shrink-0">
                <ShieldAlert className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-sm text-rose-900">
                  Kural Dışı Outlet Satışı — Kampanya Sızması
                </div>
                <div className="text-[11px] text-rose-800/70">
                  Outlet ürünü sabit fiyatlıdır; yönetim izi olmadan indirim uygulanamaz.
                  Bu satırlarda kampanya indirimi outlet ürüne işlemiş.
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-lg font-bold tabular-nums text-rose-600">
                  −{fmt(summary.leak_loss)}
                </div>
                <div className="text-[11px] text-rose-800/70">{leaks.length} satır · kaçak indirim</div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left font-medium px-3 py-2">Tarih</th>
                    <th className="text-left font-medium px-3 py-2">Mağaza</th>
                    <th className="text-left font-medium px-3 py-2">Fiş</th>
                    <th className="text-left font-medium px-3 py-2">Ürün</th>
                    <th className="text-right font-medium px-3 py-2">Etiket</th>
                    <th className="text-right font-medium px-3 py-2">Satılan</th>
                    <th className="text-right font-medium px-3 py-2">İnd%</th>
                    <th className="text-left font-medium px-3 py-2">Kampanya</th>
                    <th className="text-left font-medium px-3 py-2">Satıcı</th>
                  </tr>
                </thead>
                <tbody>
                  {leaks.map((r, i) => (
                    <tr key={`${r.ref}-${i}`} className="border-t border-border/40 hover:bg-rose-50/40">
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{fmtDateTr(r.date)}</td>
                      <td className="px-3 py-2">{r.store}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.ref}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium truncate max-w-56">{r.desc ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {r.code ?? ""}
                          {r.stock_match ? (
                            <span className="ml-1.5 text-emerald-700 font-semibold">✓ sayımda</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(r.price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-rose-600">
                        {fmt(r.sold)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">%{r.disc_pct.toFixed(1)}</td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-44">{r.campaign ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.salesperson ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {girne.length > 0 ? (
        <Card className="overflow-hidden border-amber-200">
          <CardContent className="p-0">
            <div className="px-4 py-3 border-b border-amber-200/70 bg-amber-50/50 flex items-start gap-2 flex-wrap">
              <div className="h-7 w-7 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
                <ShieldAlert className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-sm text-amber-900">
                  Girne&apos;de Outlet Ürünü Satışı
                </div>
                <div className="text-[11px] text-amber-800/70">
                  Girne&apos;de outlet reyonu yok — outlet fiyatlı ayakkabı/terlik/sandalet
                  satışları kontrol edilmeli. &quot;L/M outlet kodu&quot; rozeti: aynı ürün
                  Lefkoşa/Mağusa outlet reyonunda da satılmış.
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-lg font-bold tabular-nums text-amber-600">{girne.length}</div>
                <div className="text-[11px] text-amber-800/70">satış satırı</div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left font-medium px-3 py-2">Tarih</th>
                    <th className="text-left font-medium px-3 py-2">Fiş</th>
                    <th className="text-left font-medium px-3 py-2">Ürün</th>
                    <th className="text-right font-medium px-3 py-2">Etiket</th>
                    <th className="text-right font-medium px-3 py-2">Satılan</th>
                    <th className="text-right font-medium px-3 py-2">İnd%</th>
                    <th className="text-left font-medium px-3 py-2">Kod Eşleşmesi</th>
                  </tr>
                </thead>
                <tbody>
                  {girne.map((r, i) => (
                    <tr key={`${r.ref}-${i}`} className="border-t border-border/40 hover:bg-amber-50/40">
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{fmtDateTr(r.date)}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.ref}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium truncate max-w-56">{r.desc ?? "—"}</div>
                        <div className="text-[10px] text-muted-foreground">{r.code ?? ""}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(r.price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(r.sold)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.disc_pct > 0.5 ? `%${r.disc_pct.toFixed(1)}` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.stock_match ? (
                          <span className="inline-flex items-center rounded-full bg-rose-100 text-rose-800 px-2 py-0.5 text-[10px] font-semibold">
                            ✓ Sayımda — kesin outlet
                          </span>
                        ) : r.overlap ? (
                          <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-medium">
                            L/M outlet kodu
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">fiyat denk gelmiş olabilir</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
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

function Kpi({
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
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold tabular-nums mt-1 ${accent ? "text-rose-600" : ""}`}>
          {value}
        </div>
        {sub ? <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}
