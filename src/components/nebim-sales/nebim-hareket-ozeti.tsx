"use client";

import { Loader2, Printer } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { NebimSalesSelection } from "./nebim-filters";

/**
 * MAĞAZA HAREKET ÖZETİ — Nebim V3'ün basılı raporuyla BİREBİR aynı düzen
 * (sahibi, 07.11.2026: "Nebim'in yaptığı gibi mağaza hareket özetiyle birebir
 * aynı yap"). Örnek: S02 Mağusa 06.11.2026 çıktısı.
 *
 *   Mağaza Hareket Özeti (ortada başlık)
 *   S02   Mağusa Mağaza
 *   Satış — Süreç Açıklaması · İade · Miktar · Tutar (VD) · İskonto (VD) ·
 *           Vergi Matrahı · Vergi · Net Tutar; satırlar Normal / İade /
 *           Toplam / Genel Toplam
 *   Ödemeler — Ödeme Tipi · Para Birimi · Kredi Kartı Tipi · Vade Sayısı ·
 *           Taksitli Satış Peşinatı · Peşinat · Taksit Ödemesi · Taksit Ödeme
 *           İadesi · Peşinat İadesi · Diğer Ödemeler · Toplam; satırlar Nakit /
 *           Kredi Kartı (banka başına) / Kredi Çeki / Genel Toplam
 *   Nakit Kasa Yekünü (sağda)
 *   Başlangıç Tarihi = …, Bitiş Tarihi = … (altta)
 *
 * Derimod'da iade müşteriye KREDİ ÇEKİ olarak verilir (nakit/kart iadesi yok):
 * Kredi Çeki satırında Peşinat = kullanılan çek, Peşinat İadesi = düzenlenen çek;
 * Genel Toplam'ın Peşinat'ı Normal satışın netine, Toplam'ı satış netine eşittir
 * — Nebim çıktısındaki denklemin aynısı. Taksit sütunları Derimod'da hep 0,00.
 * Raporda olup burada OLMAYAN: Önceki Günden Devir / Yarına Devir / Nakit Kasa
 * Bakiyeleri (kasa hesap bakiyeleri; köprü taşımıyor, sahibi istemedi).
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
/** Nebim alt satırı gün/ayı sıfırsız basar: "6.11.2026". */
function fmtDateNebim(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
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

/**
 * Basılı raporun "Kredi Kartı Tipi Açıklaması" sütunu bankayı Nebim'in kendi
 * adıyla yazar ("KOOP BANK", "T.İŞ BANKASI A.Ş."). Köprüde kart tipi gelir
 * ("Optimum Card", "Maksimum"); çıktıyla aynı okunsun diye çevrilir.
 */
function nebimBankaAdi(bank: string, cardType: string): string {
  const t = `${bank} ${cardType}`.toLocaleLowerCase("tr");
  if (t.includes("karma")) return `KARMA (${cardType})`;
  if (t.includes("koop") || t.includes("optimum")) return "KOOP BANK";
  if (t.includes("iş bankası") || t.includes("maksimum") || t.includes("maximum")) return "T.İŞ BANKASI A.Ş.";
  if (t.includes("cardplus")) return "CREDITWEST BANK";
  if (t.includes("teb")) return "TEB";
  if (t.includes("garanti")) return "GARANTİ BANKASI";
  if (t.includes("ziraat")) return "ZİRAAT BANKASI";
  return bank.toLocaleUpperCase("tr");
}

type Satir = {
  qty: number;
  amount_vi: number;
  discount: number;
  tax_base: number;
  vat: number;
  net: number;
};

// ── Basılı rapor renkleri: başlık koyu gri, "Toplam" açık gri, "Genel Toplam" koyu gri ──
const BASLIK = "bg-slate-300/70 text-slate-700 dark:bg-slate-700 dark:text-slate-100";
const TOPLAM = "bg-slate-200/60 dark:bg-slate-800/60";
const GENEL = "bg-slate-300/80 font-semibold dark:bg-slate-700";
const HUCRE = "px-2 py-1 text-right tabular-nums whitespace-nowrap";
const SOL = "px-2 py-1 whitespace-nowrap";

function SatisSatiri({ ad, iade, s, sinif = "" }: { ad: string; iade: string; s: Satir; sinif?: string }) {
  return (
    <tr className={`border-b border-slate-200/70 dark:border-slate-700 ${sinif}`}>
      <td className={SOL}>{ad}</td>
      <td className={SOL}>{iade}</td>
      <td className={HUCRE}>{fmtQty(s.qty)}</td>
      <td className={HUCRE}>{fmt(s.amount_vi)}</td>
      <td className={HUCRE}>{fmt(s.discount)}</td>
      <td className={HUCRE}>{fmt(s.tax_base)}</td>
      <td className={HUCRE}>{fmt(s.vat)}</td>
      <td className={HUCRE}>{fmt(s.net)}</td>
    </tr>
  );
}

type Odeme = {
  tip: string;
  kartTipi: string;
  pesinat: number;
  pesinatIadesi: number;
  toplam: number;
  kalin?: boolean;
  sinif?: string;
  uyari?: boolean;
};

function OdemeSatiri({ o }: { o: Odeme }) {
  const renk = o.uyari ? "text-amber-700 dark:text-amber-400" : "";
  return (
    <tr className={`border-b border-slate-200/70 dark:border-slate-700 ${o.sinif ?? ""} ${o.kalin ? "font-semibold" : ""} ${renk}`}>
      <td className={SOL}>{o.tip}</td>
      <td className={SOL}>TRY</td>
      <td className={`${SOL} max-w-[220px] truncate`} title={o.kartTipi}>{o.kartTipi}</td>
      <td className={HUCRE}>0</td>
      <td className={HUCRE}>0,00</td>
      <td className={HUCRE}>{fmt(o.pesinat)}</td>
      <td className={HUCRE}>0,00</td>
      <td className={HUCRE}>0,00</td>
      <td className={HUCRE}>{fmt(o.pesinatIadesi)}</td>
      <td className={HUCRE}>0,00</td>
      <td className={`${HUCRE} font-semibold`}>{fmt(o.toplam)}</td>
    </tr>
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

const ODEME_BASLIK: { ad: string; sag?: boolean }[] = [
  { ad: "Ödeme Tipi Açıklaması" },
  { ad: "Para Birimi" },
  { ad: "Kredi Kartı Tipi Açıklaması" },
  { ad: "Vade Sayısı", sag: true },
  { ad: "Taksitli Satış Peşinatı", sag: true },
  { ad: "Peşinat", sag: true },
  { ad: "Taksit Ödemesi", sag: true },
  { ad: "Taksit Ödeme İadesi", sag: true },
  { ad: "Peşinat İadesi", sag: true },
  { ad: "Diğer Ödemeler", sag: true },
  { ad: "Toplam", sag: true },
];

function Baslik({ kolonlar }: { kolonlar: { ad: string; sag?: boolean }[] }) {
  return (
    <thead>
      <tr className={`${BASLIK} text-[11px]`}>
        {kolonlar.map((h) => (
          <th key={h.ad} className={`px-2 py-1.5 font-semibold ${h.sag ? "text-right" : "text-left"}`}>
            {h.ad}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function NebimHareketOzeti({ filters }: { filters: NebimSalesSelection }) {
  const q = trpc.nebimSales.storeMovement.useQuery({
    store_id: filters.storeId || undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
    dates: filters.dates.length ? filters.dates : undefined,
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
  const donem = d.dates?.length
    ? `${d.dates.map(fmtDateTr).join(" + ")} (seçili günler, birleşik)`
    : tekGun
      ? fmtDateTr(d.date_from)
      : `${fmtDateTr(d.date_from)} – ${fmtDateTr(d.date_to)}`;
  const altSatir = `Başlangıç Tarihi = ${fmtDateNebim(d.date_from)}, Bitiş Tarihi = ${fmtDateNebim(d.date_to)}${
    d.dates && d.dates.length > 1 ? ` (yalnız ${d.dates.map((x) => Number(x.slice(8, 10))).join(", ")} günleri)` : ""
  }`;
  const yazdirmaTarihi = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long" }).format(new Date());

  return (
    <div className="space-y-6">
      {/* Dönem başlığı */}
      <div className="flex items-baseline gap-3 flex-wrap print:hidden">
        <span className="inline-flex items-center gap-2 text-base font-semibold">
          <Printer className="h-4 w-4 text-muted-foreground" />
          Mağaza Hareket Özeti
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">{donem}</span>
        <Button variant="outline" size="sm" className="ml-auto h-8" onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5 mr-1.5" />
          Yazdır
        </Button>
      </div>

      {/* Tüm mağazalar seçiliyken dönem toplamı — Nebim'de yok, mağaza sayfalarının üstünde kalır */}
      {d.stores.length > 1 ? (
        <Card className="overflow-hidden bg-muted/20 print:hidden">
          <CardContent className="px-5 py-3 text-sm flex flex-wrap gap-x-6 gap-y-1 tabular-nums">
            <span className="text-muted-foreground">Dönem toplamı · {d.stores.length} mağaza</span>
            <span>Net satış <b>{fmtTL(d.grand.total.net)}</b></span>
            <span>Nakit <b>{fmtTL(d.grand.cash)}</b></span>
            <span>Kredi kartı <b>{fmtTL(d.grand.card)}</b></span>
            <span>Miktar <b>{fmtQty(d.grand.total.qty)}</b></span>
          </CardContent>
        </Card>
      ) : null}

      {d.stores.map((m) => {
        const iadeVar = m.sales.returns.qty !== 0 || m.sales.returns.net !== 0;
        const cekVar = m.payments.voucher_used !== 0 || m.payments.voucher_issued !== 0;
        const odemeler: Odeme[] = [
          { tip: "Nakit", kartTipi: "", pesinat: m.payments.cash, pesinatIadesi: 0, toplam: m.payments.cash, kalin: true },
          // Nebim banka satırlarını ada göre sıralar (KOOP BANK, T.İŞ BANKASI…)
          ...m.payments.cards
            .map<Odeme>((c) => ({
              tip: "Kredi Kartı",
              kartTipi: nebimBankaAdi(c.bank, c.card_type),
              pesinat: c.amount,
              pesinatIadesi: 0,
              toplam: c.amount,
            }))
            .sort((a, b) => a.kartTipi.localeCompare(b.kartTipi, "tr")),
          ...(cekVar
            ? [{ tip: "Kredi Çeki", kartTipi: "", pesinat: m.payments.voucher_used, pesinatIadesi: m.payments.voucher_issued, toplam: m.payments.voucher_used + m.payments.voucher_issued } satisfies Odeme]
            : []),
          ...(Math.abs(m.payments.unexplained) > 0.01
            ? [{ tip: "Aktarılmayan ödeme", kartTipi: "köprüde ödeme satırı olmayan fatura(lar)", pesinat: m.payments.unexplained, pesinatIadesi: 0, toplam: m.payments.unexplained, uyari: true } satisfies Odeme]
            : []),
        ];
        const genel: Odeme = {
          tip: "Genel Toplam",
          kartTipi: "",
          pesinat: odemeler.reduce((s, o) => s + o.pesinat, 0),
          pesinatIadesi: odemeler.reduce((s, o) => s + o.pesinatIadesi, 0),
          toplam: m.payments.total + (Math.abs(m.payments.unexplained) > 0.01 ? m.payments.unexplained : 0),
          sinif: GENEL,
        };
        return (
          <Card key={m.store_id ?? m.code ?? m.name} className="overflow-hidden print:border-0 print:shadow-none">
            <CardContent className="p-0 text-[12.5px]">
              {/* Rapor başlığı — basılı sayfa */}
              <div className="px-5 pt-5 pb-3">
                <div className="text-center text-lg font-bold tracking-tight">Mağaza Hareket Özeti</div>
                <div className="mt-3 flex items-baseline gap-6">
                  <span className="font-mono underline underline-offset-2">{m.code ?? "—"}</span>
                  <span className="font-semibold">{magazaAdi(m.code, m.name)}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground tabular-nums print:hidden">
                    {m.invoices} fatura{m.return_invoices > 0 ? ` · ${m.return_invoices} iade` : ""}
                  </span>
                </div>
              </div>

              {/* SATIŞ */}
              <div className="px-5">
                <div className="font-semibold mb-1">Satış</div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <Baslik kolonlar={SATIS_BASLIK} />
                    <tbody>
                      <SatisSatiri ad="Fatura Peşin Satış" iade="Normal" s={m.sales.normal} />
                      {iadeVar ? <SatisSatiri ad="Fatura Peşin Satış" iade="İade" s={m.sales.returns} /> : null}
                      <SatisSatiri ad="Peşin Satış" iade="Toplam" s={m.sales.total} sinif={TOPLAM} />
                      <SatisSatiri ad="Genel Toplam" iade="" s={m.sales.total} sinif={GENEL} />
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ÖDEMELER */}
              <div className="px-5 pt-5">
                <div className="font-semibold mb-1">Ödemeler</div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <Baslik kolonlar={ODEME_BASLIK} />
                    <tbody>
                      {odemeler.map((o, i) => (
                        <OdemeSatiri key={`${o.tip}-${o.kartTipi}-${i}`} o={o} />
                      ))}
                      <OdemeSatiri o={genel} />
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Kasa satırları — Nebim sağ hizalı yazar; yalnız hesaplanabilen var */}
              <div className="px-5 pt-5 pb-2 flex justify-end">
                <table className="tabular-nums">
                  <tbody>
                    <tr>
                      <td className="pr-6 py-0.5 font-semibold text-right">Nakit Kasa Yekünü</td>
                      <td className="py-0.5 text-right font-semibold">{fmt(m.payments.cash)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Alt satır — tarih aralığı solda, yazdırma tarihi sağda (Nebim gibi) */}
              <div className="px-5 pb-4 pt-6 flex items-baseline justify-between gap-4 text-[12px]">
                <span className="tabular-nums">{altSatir}</span>
                <span className="text-muted-foreground">{yazdirmaTarihi}</span>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <p className="text-[12px] leading-relaxed text-muted-foreground max-w-3xl print:hidden">
        Nebim çıktısındaki <strong className="font-medium">Önceki Günden Devir / Yarına Devir /
        Nakit Kasa Bakiyeleri</strong> burada yok: bunlar Nebim&apos;in kasa hesap bakiyeleri, köprü
        yalnız satış ve ödeme satırlarını taşıyor. Taksit sütunları Derimod&apos;da hep 0,00&apos;dır.
      </p>
    </div>
  );
}
