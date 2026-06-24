"use client";

import { format } from "date-fns";
import { tr } from "date-fns/locale";
import {
  ShoppingCart,
  Loader2,
  ChevronDown,
  RotateCcw,
  User,
  UserCircle2,
  CreditCard,
  Banknote,
  Megaphone,
  ShieldCheck,
  StickyNote,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { NebimSalesSelection } from "./nebim-filters";

const TRY2 = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (n: number | null | undefined) => (n == null ? "—" : TRY2.format(n));

export function NebimList({ filters }: { filters: NebimSalesSelection }) {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.nebimSales.list.useInfiniteQuery(
      {
        store_id: filters.storeId || undefined,
        date_from: filters.dateFrom || undefined,
        date_to: filters.dateTo || undefined,
        only_returns: filters.onlyReturns || undefined,
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
  const items = data?.pages.flatMap((p) => p.items) ?? [];

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
        <Card className="mb-5">
          <CardContent className="p-0 divide-y">
            {summary.by_store.map((s) => (
              <div
                key={s.store_id ?? "none"}
                className="px-5 py-3 flex items-center justify-between"
              >
                <span className="text-sm font-medium">
                  {s.store_name ?? "(eşleşmeyen mağaza)"}
                </span>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums">
                    ₺{fmt(s.net)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {s.lines} satır
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
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
        <Card>
          <CardContent className="p-0 divide-y">
            {items.map((r) => (
              <div
                key={r.id}
                className="px-5 py-3 flex items-center gap-4 hover:bg-muted/20 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold truncate">
                      {r.item_desc ?? r.item_code ?? "—"}
                    </span>
                    {r.is_return ? (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
                        <RotateCcw className="h-3 w-3" /> İade
                      </span>
                    ) : null}
                    <PaymentBadge paymentType={r.payment_type} cardType={r.card_type} />
                    {r.campaign ? (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-orange-50 text-orange-700 border-orange-200 max-w-[240px] truncate"
                        title={r.campaign}
                      >
                        <Megaphone className="h-3 w-3 shrink-0" />
                        <span className="truncate">{r.campaign}</span>
                      </span>
                    ) : null}
                    {r.discount_reason ? (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200"
                        title="İskonto nedeni"
                      >
                        <ShieldCheck className="h-3 w-3" />
                        {r.discount_reason}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5 mt-1">
                    <span className="font-medium text-foreground/80">
                      {r.store_name ?? "—"}
                    </span>
                    <span className="text-muted-foreground/50">·</span>
                    <span>
                      {format(new Date(r.invoice_date), "d MMM yyyy", { locale: tr })}
                    </span>
                    <span className="text-muted-foreground/50">·</span>
                    <span>Fiş {r.invoice_ref}</span>
                    {r.color_desc || r.size ? (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <span>{[r.color_desc, r.size].filter(Boolean).join(" / ")}</span>
                      </>
                    ) : null}
                    {r.salesperson_name ? (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <span className="inline-flex items-center gap-1" title="Satıcı">
                          <User className="h-3 w-3 text-muted-foreground/70" />
                          {r.salesperson_name}
                        </span>
                      </>
                    ) : null}
                    {r.customer_name ? (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <span
                          className="inline-flex items-center gap-1 text-indigo-600 font-medium"
                          title="Müşteri"
                        >
                          <UserCircle2 className="h-3 w-3" />
                          {r.customer_name}
                        </span>
                      </>
                    ) : null}
                  </div>
                  {r.invoice_note ? (
                    <div className="mt-1.5 text-[11px] text-amber-800/90 bg-amber-50/70 border-l-2 border-amber-300 pl-2 pr-1 py-0.5 rounded-r flex items-start gap-1">
                      <StickyNote className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
                      <span className="whitespace-pre-line line-clamp-2">{r.invoice_note}</span>
                    </div>
                  ) : null}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-base font-bold tabular-nums tracking-tight">
                    ₺{fmt(r.net_amount)}
                  </div>
                  <DiscountTag
                    amount={r.amount_vi}
                    net={r.net_amount}
                    isReturn={r.is_return}
                  />
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    {r.qty} adet
                  </div>
                </div>
              </div>
            ))}
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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="text-lg font-bold tabular-nums tracking-tight mt-1">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

/** İndirim göstergesi — orijinal (üstü çizili) + indirim % rozeti. İade/indirimsizde gizli. */
function DiscountTag({
  amount,
  net,
  isReturn,
}: {
  amount: number | null;
  net: number | null;
  isReturn: boolean;
}) {
  if (isReturn || amount == null || net == null || amount <= 0) return null;
  const diff = amount - net;
  const pct = (diff / amount) * 100;
  if (pct < 1) return null; // indirimsiz / yuvarlama gürültüsü
  return (
    <div className="flex items-center justify-end gap-1.5 mt-0.5">
      <span className="text-[11px] tabular-nums text-muted-foreground line-through">
        ₺{fmt(amount)}
      </span>
      <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full tabular-nums">
        −%{Math.round(pct)}
      </span>
    </div>
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
  if (!paymentType) return null;
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
      <Icon className="h-3 w-3" />
      {paymentType}
      {isCard && cardType ? ` · ${cardType}` : ""}
    </span>
  );
}
