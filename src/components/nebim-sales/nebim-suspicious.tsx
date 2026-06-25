"use client";

import { format } from "date-fns";
import { tr } from "date-fns/locale";
import {
  ShieldAlert,
  Loader2,
  ChevronDown,
  User,
  UserCircle2,
  Megaphone,
  CheckCircle2,
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

type Item = {
  id: string;
  invoice_ref: string;
  invoice_date: string | Date;
  store_name: string | null;
  item_code: string | null;
  item_desc: string | null;
  color_desc: string | null;
  size: string | null;
  salesperson_name: string | null;
  customer_name: string | null;
  campaign: string | null;
  price: number | null;
  amount_vi: number | null;
  net_amount: number | null;
  discount_pct: number | null;
  reason: string;
};

export function NebimSuspicious({ filters }: { filters: NebimSalesSelection }) {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.nebimSales.suspicious.useInfiniteQuery(
      {
        store_id: filters.storeId || undefined,
        date_from: filters.dateFrom || undefined,
        date_to: filters.dateTo || undefined,
        limit: 50,
      },
      { getNextPageParam: (last) => last.nextCursor ?? undefined }
    );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" />
          Şüpheli satışlar taranıyor…
        </CardContent>
      </Card>
    );
  }

  const summary = data?.pages[0]?.summary;
  const bySales = data?.pages[0]?.by_salesperson ?? [];
  const items = (data?.pages.flatMap((p) => p.items) ?? []) as Item[];

  return (
    <div className="space-y-5">
      {/* Açıklama + özet */}
      <Card className="border-rose-200/70">
        <CardContent className="p-4">
          <div className="flex items-start gap-2">
            <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-sm text-rose-900">
                Şüpheli Satışlar — kontrol et
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Yönetim onayı (özel talep/açıklama) <b>olmayan</b> satışlardan, kampanya
                kuralına uymayanlar: indirim %20/%40/%50 dışı; hiç indirim yok ama fiyat
                outlet (1.499,99 / 1.999,99 / 2.499,99 / 2.999,99) değil; <b>ya da Haziran
                ayında %40</b> (o ay kampanyada %40 yok).
              </p>
            </div>
          </div>

          {summary ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
              <Stat label="Toplam Şüpheli" value={String(summary.total)} accent />
              <Stat label="Kural Dışı İndirim" value={String(summary.weird)} />
              <Stat label="Haziran %40" value={String(summary.june40)} />
              <Stat label="Tam Fiyat (outlet değil)" value={String(summary.fullprice)} />
            </div>
          ) : null}

          {bySales.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="text-[11px] text-muted-foreground mr-1 self-center">
                Satıcıya göre:
              </span>
              {bySales.slice(0, 8).map((s) => (
                <span
                  key={s.name}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border bg-muted/50"
                >
                  <User className="h-3 w-3 text-muted-foreground" />
                  {s.name}
                  <span className="font-semibold text-rose-600">{s.count}</span>
                </span>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-emerald-500/60" />
            <div className="font-medium text-foreground">Şüpheli satış yok</div>
            <div className="text-sm mt-1">
              Bu aralıkta kampanya kuralı dışına çıkan satış bulunamadı.
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left font-semibold px-3 py-2.5">Sebep</th>
                    <th className="text-left font-semibold px-3 py-2.5">Ürün</th>
                    <th className="text-left font-semibold px-3 py-2.5">Satıcı</th>
                    <th className="text-left font-semibold px-3 py-2.5">Müşteri</th>
                    <th className="text-left font-semibold px-3 py-2.5">Mağaza · Fiş</th>
                    <th className="text-right font-semibold px-3 py-2.5">Orijinal</th>
                    <th className="text-right font-semibold px-3 py-2.5 pr-4">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <SuspiciousRow key={r.id} r={r} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col items-center gap-2">
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
        {items.length > 0 ? (
          <div className="text-xs text-muted-foreground">
            {items.length} satır gösteriliyor{!hasNextPage ? " · son" : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SuspiciousRow({ r }: { r: Item }) {
  const pct = r.discount_pct;
  const reasonCls =
    r.reason === "fullprice"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : r.reason === "june40"
        ? "bg-violet-50 text-violet-700 border-violet-200"
        : "bg-rose-50 text-rose-700 border-rose-200";
  const reasonText =
    r.reason === "fullprice"
      ? "Tam fiyat — indirim yok"
      : r.reason === "june40"
        ? `Haziran'da %${pct == null ? "40" : Math.round(pct)} (olmamalı)`
        : `İndirim %${pct == null ? "?" : Math.round(pct)} (kural dışı)`;
  return (
    <tr className="border-b border-border/50 hover:bg-rose-50/30 transition-colors">
      {/* Sebep */}
      <td className="align-top px-3 py-3 max-w-[220px]">
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${reasonCls}`}
        >
          <ShieldAlert className="h-3 w-3 shrink-0" />
          {reasonText}
        </span>
        {r.campaign ? (
          <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Megaphone className="h-3 w-3 text-orange-400 shrink-0" />
            <span className="truncate">{r.campaign}</span>
          </div>
        ) : null}
      </td>

      {/* Ürün */}
      <td className="align-top px-3 py-3 max-w-[240px]">
        <div className="font-semibold truncate">{r.item_desc ?? r.item_code ?? "—"}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {r.item_code ? <span className="font-mono">{r.item_code}</span> : null}
          {r.color_desc || r.size
            ? ` · ${[r.color_desc, r.size].filter(Boolean).join(" / ")}`
            : ""}
        </div>
      </td>

      {/* Satıcı */}
      <td className="align-top px-3 py-3 max-w-[150px]">
        {r.salesperson_name ? (
          <span className="flex items-center gap-1.5 font-medium">
            <User className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
            <span className="truncate">{r.salesperson_name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>

      {/* Müşteri */}
      <td className="align-top px-3 py-3 max-w-[150px]">
        {r.customer_name ? (
          <span className="flex items-center gap-1.5">
            <UserCircle2 className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
            <span className="truncate text-foreground/90">{r.customer_name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>

      {/* Mağaza · Fiş */}
      <td className="align-top px-3 py-3 whitespace-nowrap">
        <div className="font-medium text-foreground/90">{r.store_name ?? "—"}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {format(new Date(r.invoice_date), "d MMM yyyy", { locale: tr })} · {r.invoice_ref}
        </div>
      </td>

      {/* Orijinal */}
      <td className="align-top px-3 py-3 text-right whitespace-nowrap tabular-nums text-muted-foreground">
        ₺{fmt(r.amount_vi)}
      </td>

      {/* Net */}
      <td className="align-top px-3 py-3 pr-4 text-right whitespace-nowrap">
        <span className="text-[15px] font-bold tabular-nums tracking-tight">
          ₺{fmt(r.net_amount)}
        </span>
      </td>
    </tr>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${accent ? "text-rose-600" : ""}`}>
        {value}
      </div>
    </div>
  );
}
