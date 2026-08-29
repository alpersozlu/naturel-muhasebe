"use client";

import { Loader2, Printer, ReceiptText, Wallet } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import type { NebimSalesSelection } from "./nebim-filters";

/**
 * MAĞAZA HAREKET ÖZETİ — Nebim V3'ün basılı raporunun ekran karşılığı.
 * Seçilen tarih/aralık için mağaza mağaza satış + ödeme kırılımı.
 * Sütun adları bilerek Nebim'deki gibi bırakıldı; kullanıcı iki çıktıyı
 * yan yana koyup karşılaştırabilsin.
 */

const TRY = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (n: number) => TRY.format(n ?? 0);
const fmtQty = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDateTr(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

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

const SATIS_BASLIK = [
  "Süreç Açıklaması",
  "İade",
  "Miktar",
  "Tutar (VD)",
  "İskonto (VD)",
  "Vergi Matrahı",
  "Vergi",
  "Net Tutar",
];

function SatisSatiri({
  ad,
  iade,
  s,
  vurgu = false,
}: {
  ad: string;
  iade: string;
  s: Satir;
  vurgu?: boolean;
}) {
  const cls = vurgu ? "font-semibold bg-muted/50" : "";
  return (
    <tr className={`border-t border-border ${cls}`}>
      <td className="px-3 py-2 whitespace-nowrap">{ad}</td>
      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{iade}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtQty(s.qty)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmt(s.amount_vi)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmt(s.discount)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmt(s.tax_base)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmt(s.vat)}</td>
      <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(s.net)}</td>
    </tr>
  );
}

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

  return (
    <div className="space-y-5">
      {/* Dönem şeridi */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Printer className="h-4 w-4 text-muted-foreground" />
          Mağaza Hareket Özeti
        </span>
        <span className="text-muted-foreground">
          {tekGun
            ? fmtDateTr(d.date_from)
            : `${fmtDateTr(d.date_from)} – ${fmtDateTr(d.date_to)}`}
        </span>
        {d.stores.length > 1 ? (
          <span className="ml-auto text-muted-foreground tabular-nums">
            Genel toplam net{" "}
            <strong className="text-foreground">₺{fmt(d.grand.total.net)}</strong> · nakit ₺
            {fmt(d.grand.cash)} · kart ₺{fmt(d.grand.card)}
          </span>
        ) : null}
      </div>

      {d.stores.map((m) => (
        <Card key={m.store_id ?? m.code ?? m.name}>
          <CardContent className="p-0">
            {/* Mağaza başlığı — Nebim çıktısındaki "S02  Mağusa Mağaza" satırı */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <span className={`h-2 w-2 rounded-full ${storeDot(m.code, m.name)}`} />
              <span className="font-mono text-xs text-muted-foreground">{m.code ?? "—"}</span>
              <span className="font-semibold">{m.name}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {m.invoices} fatura
                {m.return_invoices > 0 ? ` · ${m.return_invoices} iade` : ""}
              </span>
            </div>

            {/* SATIŞ */}
            <div className="px-4 pt-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                <ReceiptText className="h-3.5 w-3.5" /> Satış
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                      {SATIS_BASLIK.map((h, i) => (
                        <th
                          key={h}
                          className={`px-3 py-1.5 font-medium ${i >= 2 ? "text-right" : "text-left"}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <SatisSatiri ad="Fatura Peşin Satış" iade="Normal" s={m.sales.normal} />
                    {m.sales.returns.qty !== 0 || m.sales.returns.net !== 0 ? (
                      <SatisSatiri ad="Fatura Peşin Satış" iade="İade" s={m.sales.returns} />
                    ) : null}
                    <SatisSatiri ad="Peşin Satış" iade="Toplam" s={m.sales.total} vurgu />
                  </tbody>
                </table>
              </div>
            </div>

            {/* ÖDEMELER */}
            <div className="px-4 py-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 mt-2">
                <Wallet className="h-3.5 w-3.5" /> Ödemeler
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-1.5 text-left font-medium">Ödeme Tipi</th>
                      <th className="px-3 py-1.5 text-left font-medium">Kart / Banka</th>
                      <th className="px-3 py-1.5 text-right font-medium">Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-border">
                      <td className="px-3 py-2 font-medium">Nakit</td>
                      <td className="px-3 py-2 text-muted-foreground">TRY</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(m.payments.cash)}</td>
                    </tr>
                    {m.payments.cards.map((c) => (
                      <tr key={c.card_type} className="border-t border-border">
                        <td className="px-3 py-2">Kredi Kartı</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {c.bank}
                          {c.bank !== c.card_type ? (
                            <span className="text-xs"> ({c.card_type})</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(c.amount)}</td>
                      </tr>
                    ))}
                    {m.payments.voucher_used !== 0 ? (
                      <tr className="border-t border-border">
                        <td className="px-3 py-2">Kredi Çeki</td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">
                          çekle ödenen
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt(m.payments.voucher_used)}
                        </td>
                      </tr>
                    ) : null}
                    {m.payments.voucher_issued !== 0 ? (
                      <tr className="border-t border-border">
                        <td className="px-3 py-2">Kredi Çeki İadesi</td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">
                          iade/değişimde düzenlenen çek
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt(m.payments.voucher_issued)}
                        </td>
                      </tr>
                    ) : null}
                    {Math.abs(m.payments.unexplained) > 0.01 ? (
                      <tr className="border-t border-border">
                        <td className="px-3 py-2 text-amber-600 dark:text-amber-500">
                          Aktarılmayan ödeme
                        </td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">
                          köprüde ödeme satırı olmayan fatura(lar) — havale/hediye kart vb.
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-500">
                          {fmt(m.payments.unexplained)}
                        </td>
                      </tr>
                    ) : null}
                    <tr className="border-t border-border bg-muted/50 font-semibold">
                      <td className="px-3 py-2">Genel Toplam</td>
                      <td className="px-3 py-2 text-xs font-normal text-muted-foreground">
                        {Math.abs(m.payments.unexplained) > 0.01
                          ? "aktarılan ödemeler"
                          : "satış netiyle birebir"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(m.payments.total)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Nakit yekünü — devir Nebim'in kasa bakiyesinden gelir, bizde yok */}
              <div className="mt-3 flex flex-wrap items-center justify-end gap-x-6 gap-y-1 text-sm">
                <span className="text-muted-foreground">
                  Nakit Kasa Yekünü{" "}
                  <strong className="text-foreground tabular-nums">
                    ₺{fmt(m.payments.cash)}
                  </strong>
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground">
        Nebim çıktısındaki <strong>Önceki Günden Devir / Yarına Devir / Nakit Kasa
        Bakiyeleri</strong> burada yok: bunlar Nebim&apos;in kasa hesap bakiyeleri, köprü
        yalnız satış ve ödeme satırlarını taşıyor. Günün nakit yekünü yukarıda
        hesaplanıyor.
      </p>
    </div>
  );
}
