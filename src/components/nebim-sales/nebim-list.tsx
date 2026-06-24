"use client";

import { useState } from "react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import {
  ShoppingCart,
  Loader2,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  User,
  UserCircle2,
  CreditCard,
  Banknote,
  Megaphone,
  ShieldCheck,
  StickyNote,
  KeyRound,
  Receipt,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { DiscountBand } from "@/lib/zod-schemas/nebim-sales";
import type { NebimSalesSelection } from "./nebim-filters";

const TRY2 = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (n: number | null | undefined) => (n == null ? "—" : TRY2.format(n));

type Item = {
  id: string;
  invoice_ref: string;
  sort_order: number;
  invoice_date: string | Date;
  store_name: string | null;
  is_return: boolean;
  item_code: string | null;
  item_desc: string | null;
  color_desc: string | null;
  size: string | null;
  salesperson_name: string | null;
  customer_name: string | null;
  payment_type: string | null;
  card_type: string | null;
  qty: number;
  amount_vi: number | null;
  net_amount: number | null;
  invoice_note: string | null;
  mgmt_note: string | null;
  discount_reason: string | null;
  campaign: string | null;
};

/** İndirim oranı (iade/indirimsizde null). */
function discountPct(r: Item): number | null {
  if (r.is_return || r.amount_vi == null || r.net_amount == null || r.amount_vi <= 0) {
    return null;
  }
  const pct = ((r.amount_vi - r.net_amount) / r.amount_vi) * 100;
  return pct >= 0.5 ? pct : null;
}

/** İndirim oranına göre renk skalası (yüksek = daha sıcak). */
function discountClass(pct: number): string {
  if (pct >= 40) return "bg-rose-50 text-rose-700 border-rose-200";
  if (pct >= 20) return "bg-orange-50 text-orange-700 border-orange-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

export function NebimList({ filters }: { filters: NebimSalesSelection }) {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.nebimSales.list.useInfiniteQuery(
      {
        store_id: filters.storeId || undefined,
        date_from: filters.dateFrom || undefined,
        date_to: filters.dateTo || undefined,
        only_returns: filters.onlyReturns || undefined,
        discount_band: (filters.discountBand || undefined) as DiscountBand | undefined,
        limit: 50,
      },
      { getNextPageParam: (last) => last.nextCursor ?? undefined }
    );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-0 divide-y">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-5 py-4 flex items-center gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-1/3 rounded animate-pulse bg-muted/60" />
                <div className="h-2.5 w-1/2 rounded animate-pulse bg-muted/50" />
              </div>
              <div className="h-7 w-24 rounded animate-pulse bg-muted/60" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  const summary = data?.pages[0]?.summary;
  const items = (data?.pages.flatMap((p) => p.items) ?? []) as Item[];

  return (
    <>
      {summary ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <SummaryCard label="Net Toplam" value={`₺${fmt(summary.net_total)}`} />
          <SummaryCard label="Fiş Sayısı" value={String(summary.invoices)} />
          <SummaryCard label="Satır Sayısı" value={String(summary.lines)} />
          <SummaryCard
            label="Tarih Aralığı"
            value={
              summary.date_min && summary.date_max
                ? `${format(new Date(summary.date_min), "d MMM", { locale: tr })} – ${format(
                    new Date(summary.date_max),
                    "d MMM",
                    { locale: tr }
                  )}`
                : "—"
            }
          />
        </div>
      ) : null}

      {summary && summary.by_store.length > 0 ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
          {summary.by_store.map((s) => (
            <Card key={s.store_id ?? "none"}>
              <CardContent className="p-3.5 flex items-center justify-between">
                <span className="text-sm font-medium truncate">
                  {s.store_name ?? "(eşleşmeyen mağaza)"}
                </span>
                <div className="text-right shrink-0 ml-2">
                  <div className="text-sm font-semibold tabular-nums">₺{fmt(s.net)}</div>
                  <div className="text-[11px] text-muted-foreground">{s.lines} satır</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <ShoppingCart className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <div className="font-medium text-foreground">Satış bulunamadı</div>
            <div className="text-sm mt-1">
              Tarih aralığını değiştir ya da köprünün çalıştığından emin ol.
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="w-8" />
                    <th className="text-left font-semibold px-3 py-2.5">Ürün</th>
                    <th className="text-left font-semibold px-3 py-2.5">Mağaza · Fiş</th>
                    <th className="text-left font-semibold px-3 py-2.5">Satıcı</th>
                    <th className="text-left font-semibold px-3 py-2.5">Müşteri</th>
                    <th className="text-left font-semibold px-3 py-2.5">Ödeme</th>
                    <th className="text-right font-semibold px-3 py-2.5">Orijinal</th>
                    <th className="text-right font-semibold px-3 py-2.5">İndirim</th>
                    <th className="text-right font-semibold px-3 py-2.5 pr-4">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <NebimRow key={r.id} r={r} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 flex flex-col items-center gap-2">
        {hasNextPage ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Yükleniyor
              </>
            ) : (
              <>
                Daha fazla yükle
                <ChevronDown className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>
        ) : null}
        <div className="text-xs text-muted-foreground">
          {items.length} satır gösteriliyor
          {!hasNextPage && items.length > 0 ? " · son" : ""}
        </div>
      </div>
    </>
  );
}

function NebimRow({ r }: { r: Item }) {
  const [open, setOpen] = useState(false);
  const pct = discountPct(r);
  const hasDetail = !!(r.campaign || r.discount_reason || r.mgmt_note || r.invoice_note);

  return (
    <>
      <tr
        className={`border-b border-border/50 transition-colors ${
          hasDetail ? "cursor-pointer hover:bg-muted/40" : "hover:bg-muted/20"
        } ${r.is_return ? "bg-rose-50/30" : ""}`}
        onClick={() => hasDetail && setOpen((v) => !v)}
      >
        {/* expand + not göstergesi */}
        <td className="align-top pl-2 pr-0 py-3">
          {hasDetail ? (
            <ChevronRight
              className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""} ${
                r.mgmt_note ? "text-rose-500" : "text-muted-foreground"
              }`}
            />
          ) : null}
        </td>

        {/* Ürün */}
        <td className="align-top px-3 py-3 max-w-[280px]">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold truncate">{r.item_desc ?? r.item_code ?? "—"}</span>
            {r.is_return ? (
              <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
                <RotateCcw className="h-2.5 w-2.5" /> İade
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {r.item_code ? <span className="font-mono">{r.item_code}</span> : null}
            {r.color_desc || r.size ? (
              <span>· {[r.color_desc, r.size].filter(Boolean).join(" / ")}</span>
            ) : null}
            {/* detay göstergeleri */}
            {r.campaign ? <Megaphone className="h-3 w-3 text-orange-400" /> : null}
            {r.discount_reason ? <ShieldCheck className="h-3 w-3 text-rose-400" /> : null}
            {r.mgmt_note ? <KeyRound className="h-3 w-3 text-rose-500" /> : null}
            {r.invoice_note ? <StickyNote className="h-3 w-3 text-amber-400" /> : null}
          </div>
        </td>

        {/* Mağaza · Fiş */}
        <td className="align-top px-3 py-3 whitespace-nowrap">
          <div className="font-medium text-foreground/90">{r.store_name ?? "—"}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {format(new Date(r.invoice_date), "d MMM yyyy", { locale: tr })} · {r.invoice_ref}
          </div>
        </td>

        {/* Satıcı */}
        <td className="align-top px-3 py-3 max-w-[170px]">
          {r.salesperson_name ? (
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
              <span className="truncate">{r.salesperson_name}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>

        {/* Müşteri */}
        <td className="align-top px-3 py-3 max-w-[170px]">
          {r.customer_name ? (
            <div className="flex items-center gap-1.5">
              <UserCircle2 className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              <span className="truncate text-foreground/90">{r.customer_name}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>

        {/* Ödeme */}
        <td className="align-top px-3 py-3">
          <PaymentBadge paymentType={r.payment_type} cardType={r.card_type} />
        </td>

        {/* Orijinal */}
        <td className="align-top px-3 py-3 text-right whitespace-nowrap">
          {r.amount_vi != null ? (
            <span
              className={`tabular-nums ${
                pct != null ? "text-muted-foreground line-through" : "text-foreground/80"
              }`}
            >
              ₺{fmt(r.amount_vi)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>

        {/* İndirim */}
        <td className="align-top px-3 py-3 text-right whitespace-nowrap">
          {pct != null ? (
            <span
              className={`inline-block text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md border ${discountClass(
                pct
              )}`}
            >
              −%{Math.round(pct)}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          )}
        </td>

        {/* Net */}
        <td className="align-top px-3 py-3 pr-4 text-right whitespace-nowrap">
          <span
            className={`text-[15px] font-bold tabular-nums tracking-tight ${
              r.is_return ? "text-rose-600" : ""
            }`}
          >
            ₺{fmt(r.net_amount)}
          </span>
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {r.qty} adet
          </div>
        </td>
      </tr>

      {open && hasDetail ? (
        <tr className="border-b border-border/50 bg-muted/20">
          <td />
          <td colSpan={8} className="px-3 pb-4 pt-1">
            <DetailPanel r={r} pct={pct} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DetailPanel({ r, pct }: { r: Item; pct: number | null }) {
  const indirimTutar =
    r.amount_vi != null && r.net_amount != null ? r.amount_vi - r.net_amount : null;

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 space-y-3">
      {/* Fiyat kırılımı */}
      {r.amount_vi != null ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-muted-foreground">Orijinal</span>
          <span className="font-semibold tabular-nums">₺{fmt(r.amount_vi)}</span>
          {indirimTutar != null && indirimTutar > 0 ? (
            <>
              <span className="text-muted-foreground">−</span>
              <span className="font-semibold tabular-nums text-rose-600">
                ₺{fmt(indirimTutar)} {pct != null ? `(−%${Math.round(pct)})` : ""}
              </span>
            </>
          ) : null}
          <span className="text-muted-foreground">=</span>
          <span className="font-bold tabular-nums">Net ₺{fmt(r.net_amount)}</span>
          <span className="ml-1 text-muted-foreground">· {r.qty} adet</span>
        </div>
      ) : null}

      {/* Kampanya / Neden rozetleri */}
      {r.campaign || r.discount_reason ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {r.campaign
            ? r.campaign.split(" | ").map((c, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border bg-orange-50 text-orange-700 border-orange-200"
                >
                  <Megaphone className="h-3 w-3" /> {c}
                </span>
              ))
            : null}
          {r.discount_reason ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
              <ShieldCheck className="h-3 w-3" /> {r.discount_reason}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Yönetim açıklaması (öne çıkan) */}
      {r.mgmt_note ? (
        <div className="rounded-md border border-rose-200 bg-rose-50/70 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-rose-600 mb-0.5">
            <KeyRound className="h-3 w-3" /> Yönetim Açıklaması
          </div>
          <div className="text-xs text-rose-900 whitespace-pre-line">{r.mgmt_note}</div>
        </div>
      ) : null}

      {/* Fiş notu (ikincil) */}
      {r.invoice_note ? (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 mb-0.5">
            <Receipt className="h-3 w-3" /> Fiş Notu
          </div>
          <div className="text-xs text-amber-900 whitespace-pre-line">{r.invoice_note}</div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-lg font-bold tabular-nums tracking-tight mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

/** Ödeme tipi rozeti — Nakit (yeşil) / Kredi Kartı (mavi, + marka). */
function PaymentBadge({
  paymentType,
  cardType,
}: {
  paymentType: string | null;
  cardType: string | null;
}) {
  if (!paymentType) return <span className="text-muted-foreground text-xs">—</span>;
  const isCard = paymentType.includes("Kredi");
  const isCash = paymentType.includes("Nakit");
  const Icon = isCard ? CreditCard : Banknote;
  const cls = isCard
    ? "bg-indigo-50 text-indigo-700 border-indigo-200"
    : isCash
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${cls}`}
      title={cardType ? `Kart: ${cardType}` : undefined}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate max-w-[120px]">{paymentType}</span>
      {isCard && cardType ? <span className="text-indigo-400">· {cardType}</span> : null}
    </span>
  );
}
