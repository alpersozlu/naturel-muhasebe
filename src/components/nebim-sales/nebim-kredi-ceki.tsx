"use client";

import { useState } from "react";
import {
  Loader2, Ticket, ChevronDown, ChevronRight, User, AlertTriangle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import type { NebimSalesSelection } from "./nebim-filters";

const TRY = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (n: number | null | undefined) => `₺${TRY.format(n ?? 0)}`;

function fmtDateTr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
function weekday(iso: string): string {
  return WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()] ?? "";
}

function storeDot(name: string | null): string {
  const n = (name ?? "").toLocaleLowerCase("tr").replace(/ı/g, "i");
  if (n.includes("lefkosa") || n === "s01") return "bg-blue-500";
  if (n.includes("girne") || n === "s03") return "bg-emerald-500";
  if (n.includes("magusa") || n === "s02") return "bg-amber-500";
  return "bg-slate-400";
}

/** CV seri numarasını kısalt: CV1000000000000005740 → CV…5740 */
function shortSerial(serial: string | null): string {
  if (!serial) return "—";
  return serial.length > 8 ? `CV…${serial.replace(/^CV0*|^CV1?0+/, "").slice(-4).padStart(4, "0")}` : serial;
}

type KrediCekiData = {
  has_data: boolean;
  kpi: {
    used_total: number; used_count: number;
    issued_total: number; issued_count: number;
    active_total: number; active_count: number;
    expired_total: number; expired_count: number;
  };
  txns: Array<{
    id: string; date: string; time: string | null;
    store_name: string | null; store_code: string | null;
    amount: number; customer_code: string | null; customer_name: string | null;
    serial: string | null; invoice_ref: string | null;
    matches: Array<{
      ref: string; is_return: boolean; salesperson: string | null;
      net: number; approx: boolean;
      items: Array<{ desc: string; qty: number; net: number }>;
    }>;
  }>;
  active: Array<OpenVoucher>;
  minor: Array<OpenVoucher>;
  minor_total: number;
  expired: Array<OpenVoucher>;
  expired_more: number;
  by_store: Array<{
    store: string;
    used: number;
    used_count: number;
    issued: number;
    ciro: number;
    pay_pct: number;
  }>;
};

type OpenVoucher = {
  serial: string; amount: number; used: number; remaining: number;
  first_valid: string | null; last_valid: string | null; expired: boolean;
  issuer: { customer: string | null; date: string; store: string | null } | null;
};

export function NebimKrediCeki({ filters }: { filters: NebimSalesSelection }) {
  const { data, isLoading } = trpc.nebimSales.krediCeki.useQuery({
    store_id: filters.storeId || undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 mx-auto mb-2 animate-spin" />
          Kredi çeki verisi yükleniyor…
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  if (!data.has_data) {
    return (
      <Card>
        <CardContent className="py-6 px-4 text-sm text-muted-foreground flex items-start gap-2">
          <Ticket className="h-4 w-4 mt-0.5 shrink-0 text-rose-500" />
          <div>
            <div className="font-medium text-foreground">Kredi Çeki verisi henüz yok</div>
            Windows köprüsünde <span className="font-mono text-xs">GUNCELLE.bat</span> →{" "}
            <span className="font-mono text-xs">GECMISI-AKTAR.bat</span> çalıştırılınca
            çek hareketleri ve kalan bakiyeler burada görünecek.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Başlık + KPI */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-rose-500/10 text-rose-600 flex items-center justify-center shrink-0">
              <Ticket className="h-4 w-4" />
            </div>
            <div>
              <div className="font-semibold text-sm">Kredi Çeki</div>
              <div className="text-[11px] text-muted-foreground">
                İade/değişimde düzenlenen CV çekleri — hareketler dönem filtresine uyar,
                kalan bakiyeler günceldir
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-border/40">
            <KpiCell
              label="Dönemde Kullanılan"
              value={fmt(data.kpi.used_total)}
              sub={`${data.kpi.used_count} hareket`}
              tone="text-emerald-700"
            />
            <KpiCell
              label="Dönemde Düzenlenen"
              value={`−${fmt(data.kpi.issued_total)}`}
              sub={`${data.kpi.issued_count} çek`}
              tone="text-rose-700"
            />
            <KpiCell
              label="Açık Çek (Aktif)"
              value={fmt(data.kpi.active_total)}
              sub={`${data.kpi.active_count} çek — kullanılabilir bakiye`}
              tone="text-amber-700"
            />
            <KpiCell
              label="Süresi Dolmuş Açık"
              value={fmt(data.kpi.expired_total)}
              sub={`${data.kpi.expired_count} çek — geçerliliği bitmiş`}
              tone="text-muted-foreground"
            />
          </div>
        </CardContent>
      </Card>

      {/* Ciro payı — dükkan dükkan (çekle tahsilat ↔ mağaza cirosu) */}
      {data.by_store.some((s) => s.ciro > 0 || s.used > 0) ? (
        <CiroPayiTable rows={data.by_store} />
      ) : null}

      {/* Kalanlar — aktif açık çekler */}
      {data.active.length > 0 ? (
        <KalanlarTable
          title="Açık Çekler — Kalan Bakiyeler (aktif)"
          rows={data.active}
          highlight
        />
      ) : (
        <Card>
          <CardContent className="py-4 px-4 text-sm text-muted-foreground">
            Şu an bakiyesi olan aktif kredi çeki yok.
          </CardContent>
        </Card>
      )}

      {/* ₺50 altı artık bakiyeler — ana listeyi şişirmesin diye ayrı */}
      {data.minor.length > 0 ? (
        <MinorCollapsible rows={data.minor} total={data.minor_total} />
      ) : null}

      {/* Süresi dolmuş açık çekler (bilgi amaçlı, katlanabilir) */}
      {data.expired.length > 0 ? (
        <ExpiredCollapsible
          rows={data.expired}
          more={data.expired_more}
          total={data.kpi.expired_total}
          count={data.kpi.expired_count}
        />
      ) : null}

      {/* Hareketler — tarih tarih, mağaza mağaza */}
      <Hareketler txns={data.txns} />
    </div>
  );
}

/**
 * CİRO PAYI — dükkan dükkan: dönemde çekle yapılan tahsilatın o mağazanın
 * cirosuna oranı. Kullanıcının referans görselindeki stil: % kalın, altında
 * "ciro ₺X" soluk. TOPLAM satırı koyu.
 */
function CiroPayiTable({ rows }: { rows: KrediCekiData["by_store"] }) {
  const tUsed = rows.reduce((s, r) => s + r.used, 0);
  const tUsedCount = rows.reduce((s, r) => s + r.used_count, 0);
  const tIssued = rows.reduce((s, r) => s + r.issued, 0);
  const tCiro = rows.reduce((s, r) => s + r.ciro, 0);
  const tPct = tCiro > 0 ? (tUsed / tCiro) * 100 : 0;
  const pct = (n: number) => `%${n.toFixed(1).replace(".", ",")}`;
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="px-4 py-2.5 border-b border-border/50 text-sm font-semibold">
          Ciro Payı — Dükkan Dükkan
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            çekle tahsilatın mağaza cirosuna oranı (dönem)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-900 text-slate-100 text-[10px] uppercase tracking-wider">
                <th className="text-left font-semibold px-4 py-2.5">Mağaza</th>
                <th className="text-right font-semibold px-4 py-2.5">Çekle Tahsilat</th>
                <th className="text-right font-semibold px-4 py-2.5">Düzenlenen Çek</th>
                <th className="text-right font-semibold px-4 py-2.5">Ciro Payı</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.store} className="border-b border-border/40 hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <span className={`h-2 w-2 rounded-full ${storeDot(r.store)}`} />
                      {r.store}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="tabular-nums font-semibold">{fmt(r.used)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {r.used_count} işlem
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-rose-700">
                    {r.issued > 0 ? `−${fmt(r.issued)}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="tabular-nums font-bold">{pct(r.pay_pct)}</div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      ciro {fmt(r.ciro)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-900 text-slate-100 font-semibold">
                <td className="px-4 py-2.5">TOPLAM</td>
                <td className="px-4 py-2.5 text-right">
                  <div className="tabular-nums">{fmt(tUsed)}</div>
                  <div className="text-[10px] text-slate-300">{tUsedCount} işlem</div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {tIssued > 0 ? `−${fmt(tIssued)}` : "—"}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="tabular-nums font-bold">{pct(tPct)}</div>
                  <div className="text-[10px] text-slate-300 tabular-nums">
                    ciro {fmt(tCiro)}
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function KpiCell({
  label, value, sub, tone,
}: {
  label: string; value: string; sub: string; tone: string;
}) {
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function KalanlarTable({
  title, rows, highlight,
}: {
  title: string; rows: OpenVoucher[]; highlight?: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="px-4 py-2.5 border-b border-border/50 text-sm font-semibold flex items-center gap-2">
          {highlight ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : null}
          {title}
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {rows.length} çek · toplam{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {fmt(rows.reduce((s, r) => s + r.remaining, 0))}
            </span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-semibold px-4 py-2">Çek Seri</th>
                <th className="text-left font-semibold px-4 py-2">Müşteri</th>
                <th className="text-left font-semibold px-4 py-2">Mağaza</th>
                <th className="text-right font-semibold px-4 py-2">Çek Tutarı</th>
                <th className="text-right font-semibold px-4 py-2">Kullanılan</th>
                <th className="text-right font-semibold px-4 py-2">KALAN</th>
                <th className="text-left font-semibold px-4 py-2">Düzenlenme</th>
                <th className="text-left font-semibold px-4 py-2">Son Geçerlilik</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.serial} className="border-b border-border/40 hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs" title={r.serial}>
                    {shortSerial(r.serial)}
                  </td>
                  <td className="px-4 py-2">
                    {r.issuer?.customer ? (
                      <span className="inline-flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        {r.issuer.customer}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        — (hareket senkron aralığı dışında)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {r.issuer?.store ? (
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className={`h-2 w-2 rounded-full ${storeDot(r.issuer.store)}`} />
                        {r.issuer.store}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(r.amount)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {fmt(r.used)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-bold text-amber-700">
                    {fmt(r.remaining)}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.first_valid ? fmtDateTr(r.first_valid) : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.last_valid ? (
                      <span className={r.expired ? "text-rose-600 font-medium" : ""}>
                        {fmtDateTr(r.last_valid)}
                        {r.expired ? " · doldu" : ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** ₺50 altı kalan bakiyeler — takip değeri düşük, katlanır özet. */
function MinorCollapsible({
  rows, total,
}: {
  rows: OpenVoucher[]; total: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Küçük bakiyeler (₺50 altı): {rows.length} çek · {fmt(total)} — takip
        gerektirmez (göster/gizle)
      </button>
      {open ? (
        <div className="mt-2">
          <KalanlarTable title="Küçük Bakiyeler (₺50 altı)" rows={rows} />
        </div>
      ) : null}
    </div>
  );
}

function ExpiredCollapsible({
  rows, more, total, count,
}: {
  rows: OpenVoucher[]; more: number; total: number; count: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Süresi dolmuş açık çekler: {count} çek · {fmt(total)} (kullanılamaz — göster/gizle)
      </button>
      {open ? (
        <div className="mt-2">
          <KalanlarTable title="Süresi Dolmuş Açık Çekler" rows={rows} />
          {more > 0 ? (
            <div className="text-[11px] text-muted-foreground mt-1 px-1">
              + {more} çek daha (en yeniler gösteriliyor)
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Hareketler({ txns }: { txns: KrediCekiData["txns"] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (txns.length === 0) {
    return (
      <Card>
        <CardContent className="py-4 px-4 text-sm text-muted-foreground">
          Seçili dönemde kredi çeki hareketi yok.
        </CardContent>
      </Card>
    );
  }

  // Tarih tarih grupla (sorgu zaten desc sıralı)
  const byDay = new Map<string, typeof txns>();
  for (const t of txns) {
    const list = byDay.get(t.date) ?? [];
    list.push(t);
    byDay.set(t.date, list);
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="px-4 py-2.5 border-b border-border/50 text-sm font-semibold">
          Hareketler — tarih tarih
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            eksi = çek düzenlendi, artı = çek kullanıldı · satıra tıkla: fatura/ürünler
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <tbody>
              {Array.from(byDay.entries()).map(([day, list]) => {
                const used = list.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
                const issued = list
                  .filter((t) => t.amount < 0)
                  .reduce((s, t) => s + Math.abs(t.amount), 0);
                return [
                  <tr key={`h-${day}`} className="bg-slate-900 text-slate-100">
                    <td colSpan={6} className="px-4 py-2 text-xs font-semibold">
                      {fmtDateTr(day)} {weekday(day)}
                      <span className="ml-3 font-normal text-slate-300">
                        {used > 0 ? `kullanılan ${fmt(used)}` : ""}
                        {used > 0 && issued > 0 ? " · " : ""}
                        {issued > 0 ? `düzenlenen −${fmt(issued)}` : ""}
                      </span>
                    </td>
                  </tr>,
                  ...list.map((t) => {
                    const isOpen = !!expanded[t.id];
                    const hasDetail = t.matches.length > 0;
                    return [
                      <tr
                        key={t.id}
                        className={`border-b border-border/40 ${
                          hasDetail ? "cursor-pointer hover:bg-muted/40" : ""
                        }`}
                        onClick={() =>
                          hasDetail && setExpanded((e) => ({ ...e, [t.id]: !e[t.id] }))
                        }
                      >
                        <td className="px-4 py-2 text-xs text-muted-foreground w-14">
                          {t.time ?? ""}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span
                              className={`h-2 w-2 rounded-full ${storeDot(
                                t.store_name ?? t.store_code
                              )}`}
                            />
                            {t.store_name ?? t.store_code ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate max-w-56">
                              {t.customer_name ?? t.customer_code ?? "—"}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              t.amount > 0
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            {t.amount > 0 ? "Kullanıldı" : "Düzenlendi"}
                          </span>
                        </td>
                        <td
                          className={`px-4 py-2 text-right tabular-nums font-semibold ${
                            t.amount > 0 ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {t.amount > 0 ? "+" : "−"}
                          {fmt(Math.abs(t.amount))}
                        </td>
                        <td className="px-4 py-2 text-xs font-mono whitespace-nowrap" title={t.serial ?? ""}>
                          {shortSerial(t.serial)}
                          {hasDetail ? (
                            <span className="ml-2 text-muted-foreground">
                              {isOpen ? (
                                <ChevronDown className="inline h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="inline h-3.5 w-3.5" />
                              )}
                            </span>
                          ) : null}
                        </td>
                      </tr>,
                      isOpen && hasDetail ? (
                        <tr key={`${t.id}-d`} className="border-b border-border/40 bg-muted/20">
                          <td colSpan={6} className="px-6 py-3">
                            <div className="space-y-2">
                              {t.matches.map((m) => (
                                <div key={m.ref} className="text-xs">
                                  <div className="font-medium mb-1">
                                    Fatura {m.ref}
                                    {m.is_return ? (
                                      <span className="ml-2 rounded-full bg-rose-50 text-rose-700 px-2 py-0.5 text-[10px]">
                                        İade
                                      </span>
                                    ) : null}
                                    {m.approx ? (
                                      <span className="ml-2 rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-[10px]">
                                        tahmini eşleşme (aynı müşteri, aynı gün)
                                      </span>
                                    ) : null}
                                    {m.salesperson ? (
                                      <span className="ml-2 text-muted-foreground">
                                        satıcı: {m.salesperson}
                                      </span>
                                    ) : null}
                                    <span className="ml-2 tabular-nums font-semibold">
                                      {fmt(m.net)}
                                    </span>
                                  </div>
                                  <ul className="space-y-0.5 text-muted-foreground">
                                    {m.items.map((it, i) => (
                                      <li key={i} className="flex justify-between gap-4">
                                        <span className="truncate">
                                          {it.qty !== 1 ? `${it.qty}× ` : ""}
                                          {it.desc}
                                        </span>
                                        <span className="tabular-nums shrink-0">{fmt(it.net)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ) : null,
                    ];
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
