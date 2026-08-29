"use client";

import { Loader2, Printer } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import type { NebimSalesSelection } from "./nebim-filters";

/**
 * MAĞAZA HAREKET ÖZETİ — Nebim V3'ün basılı raporunun ekran karşılığı.
 *
 * Okuma düzeni bilinçli: önce ÖZET ŞERİDİ (net satış · nakit · kart · iade)
 * gözün tutunacağı yer; altındaki tablo referans. Nebim sütun adları
 * korunuyor (kullanıcı iki çıktıyı yan yana koyuyor) ama ara sütunlar —
 * tutar/iskonto/matrah/vergi — geri planda, NET TUTAR öne çıkıyor. Tek
 * mürekkep: renk yalnız mağaza noktasında ve uyarı satırında.
 */

const TRY = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (n: number) => TRY.format(n ?? 0);
const fmtTL = (n: number) => `₺${TRY.format(n ?? 0)}`;
const fmtQty = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDateTr(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Nebim ham adı Türkçe karaktersiz geliyor ("Magusa Magaza"); basılı raporla
 *  aynı okunsun diye koda göre düzgün ad kullanılır, kod yoksa ham ada düşer. */
const MAGAZA_ADLARI: Record<string, string> = {
  S01: "Lefkoşa Mağaza",
  S02: "Mağusa Mağaza",
  S03: "Girne Mağaza",
};
const magazaAdi = (code: string | null, raw: string) =>
  (code ? MAGAZA_ADLARI[code] : null) ?? raw;

function storeDot(code: string | null, name: string): string {
  const n = `${code ?? ""} ${name}`.toLocaleLowerCase("tr").replace(/ı/g, "i");
  if (n.includes("lefkosa") || n.includes("s01")) return "bg-blue-500";
  if (n.includes("girne") || n.includes("s03")) return "bg-emerald-500";
  if (n.includes("magusa") || n.includes("s02")) return "bg-amber-500";
  return "bg-slate-400";
}

type Satir = {
  qty: number;
  amount_vi: number;
  discount: number;
  tax_base: number;
  vat: number;
  net: number;
};

/** Özet şeridi hücresi — Müşteriler sekmesindeki StatCell ile aynı dil. */
function OzetHucre({
  label,
  value,
  sub,
  sessiz = false,
  orta = false,
}: {
  label: string;
  value: string;
  sub?: string;
  sessiz?: boolean;
  /** Dönem toplamı şeridi — mağaza kartlarıyla karışmasın diye bir tık küçük. */
  orta?: boolean;
}) {
  return (
    <div className={orta ? "px-5 pb-3.5 pt-2" : "px-5 py-4"}>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1.5 tabular-nums tracking-tight ${
          orta
            ? "text-lg font-semibold"
            : sessiz
              ? "text-lg font-medium text-muted-foreground"
              : "text-2xl font-semibold"
        }`}
      >
        {value}
      </div>
      {sub ? <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/** Satış tablosu satırı — ara sütunlar geri planda, net tutar önde. */
function SatisSatiri({
  ad,
  iade,
  s,
  toplam = false,
}: {
  ad: string;
  iade: string;
  s: Satir;
  toplam?: boolean;
}) {
  const ara = "px-4 py-2.5 text-right tabular-nums text-[13px] text-muted-foreground";
  return (
    <tr
      className={`border-t border-border/40 ${
        toplam ? "bg-muted/30 font-medium" : ""
      }`}
    >
      <td className="px-4 py-2.5 whitespace-nowrap">{ad}</td>
      <td className="px-4 py-2.5 text-[13px] text-muted-foreground whitespace-nowrap">
        {iade}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">{fmtQty(s.qty)}</td>
      <td className={ara}>{fmt(s.amount_vi)}</td>
      <td className={ara}>{fmt(s.discount)}</td>
      <td className={ara}>{fmt(s.tax_base)}</td>
      <td className={ara}>{fmt(s.vat)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
        {fmt(s.net)}
      </td>
    </tr>
  );
}

/** Ödeme satırı — etiket + sessiz açıklama solda, tutar sağda. */
function OdemeSatiri({
  ad,
  alt,
  tutar,
  toplam = false,
  uyari = false,
}: {
  ad: string;
  alt?: string;
  tutar: number;
  toplam?: boolean;
  uyari?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline gap-3 px-4 py-2.5 border-t border-border/40 ${
        toplam ? "bg-muted/30" : ""
      }`}
    >
      <span
        className={`${toplam ? "font-medium" : ""} ${
          uyari ? "text-amber-600 dark:text-amber-500" : ""
        }`}
      >
        {ad}
      </span>
      {alt ? (
        <span className="text-[12px] text-muted-foreground truncate">{alt}</span>
      ) : null}
      <span
        className={`ml-auto tabular-nums ${toplam ? "font-semibold" : ""} ${
          uyari ? "text-amber-600 dark:text-amber-500" : ""
        }`}
      >
        {fmt(tutar)}
      </span>
    </div>
  );
}

const SATIS_BASLIK: { ad: string; sag?: boolean }[] = [
  { ad: "Süreç Açıklaması" },
  { ad: "İade" },
  { ad: "Miktar", sag: true },
  { ad: "Tutar (VD)", sag: true },
  { ad: "İskonto (VD)", sag: true },
  { ad: "Vergi Matrahı", sag: true },
  { ad: "Vergi", sag: true },
  { ad: "Net Tutar", sag: true },
];

export function NebimHareketOzeti({ filters }: { filters: NebimSalesSelection }) {
  const q = trpc.nebimSales.storeMovement.useQuery({
    store_id: filters.storeId || undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
  });

  if (q.isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Hareket özeti hazırlanıyor…
      </div>
    );
  }
  if (q.isError) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-destructive">
          Hareket özeti yüklenemedi.
        </CardContent>
      </Card>
    );
  }
  const d = q.data;
  if (!d || d.stores.length === 0) {
    return (
      <Card>
        <CardContent className="py-14 text-center text-sm text-muted-foreground">
          Seçilen tarih aralığında hareket yok.
        </CardContent>
      </Card>
    );
  }

  const tekGun = d.date_from && d.date_from === d.date_to;
  const donem = tekGun
    ? fmtDateTr(d.date_from)
    : `${fmtDateTr(d.date_from)} – ${fmtDateTr(d.date_to)}`;

  return (
    <div className="space-y-6">
      {/* Dönem başlığı */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="inline-flex items-center gap-2 text-base font-semibold">
          <Printer className="h-4 w-4 text-muted-foreground" />
          Mağaza Hareket Özeti
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">{donem}</span>
      </div>

      {/* Tüm mağazalar seçiliyken dönem toplamı — üstte tek şerit */}
      {d.stores.length > 1 ? (
        <Card className="overflow-hidden bg-muted/20">
          <CardContent className="p-0">
            <div className="px-5 pt-3.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Dönem Toplamı · {d.stores.length} mağaza
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/40">
              <OzetHucre label="Net Satış" value={fmtTL(d.grand.total.net)} orta />
              <OzetHucre label="Nakit" value={fmtTL(d.grand.cash)} orta />
              <OzetHucre label="Kredi Kartı" value={fmtTL(d.grand.card)} orta />
              <OzetHucre label="Miktar" value={fmtQty(d.grand.total.qty)} orta />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {d.stores.map((m) => {
        const iadeVar = m.sales.returns.qty !== 0 || m.sales.returns.net !== 0;
        return (
          <Card key={m.store_id ?? m.code ?? m.name} className="overflow-hidden">
            <CardContent className="p-0">
              {/* Mağaza başlığı */}
              <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border/50">
                <span className={`h-2 w-2 rounded-full ${storeDot(m.code, m.name)}`} />
                <span className="font-semibold">{magazaAdi(m.code, m.name)}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {m.code ?? "—"}
                </span>
                <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">
                  {m.invoices} fatura
                  {m.return_invoices > 0 ? ` · ${m.return_invoices} iade` : ""}
                </span>
              </div>

              {/* Özet şeridi — gözün tutunduğu yer */}
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/50 border-b border-border/50">
                <OzetHucre label="Net Satış" value={fmtTL(m.sales.total.net)} />
                <OzetHucre label="Nakit" value={fmtTL(m.payments.cash)} sessiz />
                <OzetHucre
                  label="Kredi Kartı"
                  value={fmtTL(m.payments.card_total)}
                  sessiz
                  sub={
                    m.payments.cards.length > 1
                      ? `${m.payments.cards.length} banka`
                      : m.payments.cards[0]?.bank
                  }
                />
                <OzetHucre
                  label="İade"
                  value={iadeVar ? fmtTL(Math.abs(m.sales.returns.net)) : "—"}
                  sessiz
                  sub={iadeVar ? `${Math.abs(m.sales.returns.qty)} adet` : "iade yok"}
                />
              </div>

              {/* SATIŞ */}
              <div className="pt-4">
                <div className="px-5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Satış
                </div>
                <div className="overflow-x-auto mt-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70">
                        {SATIS_BASLIK.map((h) => (
                          <th
                            key={h.ad}
                            className={`px-4 py-1.5 font-normal ${
                              h.sag ? "text-right" : "text-left"
                            }`}
                          >
                            {h.ad}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <SatisSatiri
                        ad="Fatura Peşin Satış"
                        iade="Normal"
                        s={m.sales.normal}
                      />
                      {iadeVar ? (
                        <SatisSatiri
                          ad="Fatura Peşin Satış"
                          iade="İade"
                          s={m.sales.returns}
                        />
                      ) : null}
                      <SatisSatiri
                        ad="Peşin Satış"
                        iade="Toplam"
                        s={m.sales.total}
                        toplam
                      />
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ÖDEMELER */}
              <div className="pt-5 pb-4">
                <div className="px-5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
                  Ödemeler
                </div>
                <div className="text-sm">
                  <OdemeSatiri ad="Nakit" alt="TRY" tutar={m.payments.cash} />
                  {m.payments.cards.map((c) => (
                    <OdemeSatiri
                      key={c.card_type}
                      ad="Kredi Kartı"
                      alt={c.bank !== c.card_type ? `${c.bank} · ${c.card_type}` : c.bank}
                      tutar={c.amount}
                    />
                  ))}
                  {m.payments.voucher_used !== 0 ? (
                    <OdemeSatiri
                      ad="Kredi Çeki"
                      alt="çekle ödenen"
                      tutar={m.payments.voucher_used}
                    />
                  ) : null}
                  {m.payments.voucher_issued !== 0 ? (
                    <OdemeSatiri
                      ad="Kredi Çeki İadesi"
                      alt="iade/değişimde düzenlenen"
                      tutar={m.payments.voucher_issued}
                    />
                  ) : null}
                  {Math.abs(m.payments.unexplained) > 0.01 ? (
                    <OdemeSatiri
                      ad="Aktarılmayan ödeme"
                      alt="köprüde ödeme satırı olmayan fatura(lar)"
                      tutar={m.payments.unexplained}
                      uyari
                    />
                  ) : null}
                  <OdemeSatiri
                    ad="Genel Toplam"
                    alt={
                      Math.abs(m.payments.unexplained) > 0.01
                        ? "aktarılan ödemeler"
                        : "satış netiyle birebir"
                    }
                    tutar={m.payments.total}
                    toplam
                  />
                </div>

                <div className="px-5 pt-3 text-right text-[12px] text-muted-foreground">
                  Nakit Kasa Yekünü{" "}
                  <span className="text-foreground font-medium tabular-nums">
                    {fmtTL(m.payments.cash)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <p className="text-[12px] leading-relaxed text-muted-foreground max-w-3xl">
        Nebim çıktısındaki <strong className="font-medium">Önceki Günden Devir /
        Yarına Devir / Nakit Kasa Bakiyeleri</strong> burada yok: bunlar Nebim&apos;in
        kasa hesap bakiyeleri, köprü yalnız satış ve ödeme satırlarını taşıyor.
        Günün nakit yekünü yukarıda hesaplanıyor.
      </p>
    </div>
  );
}
