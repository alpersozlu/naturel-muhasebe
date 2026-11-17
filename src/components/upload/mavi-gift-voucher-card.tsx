"use client";

import { AlertTriangle, CheckCircle2, Info, Ticket } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { VoucherScan, VOUCHER_STATUS, money, dmy } from "@/components/gift-voucher/voucher-scan";

type Match = inferRouterOutputs<AppRouter>["giftVoucher"]["dayTotal"]["match"];

/**
 * MAĞAZA ÖZETİ MUTABAKATI (sahibi, 17.11.2026): Nebim özeti o gün kasadan
 * geçen hediye çekini yazar ve bunu YALNIZ barkodlu çekler için yapabilir.
 * İki rakam birebir tutuyorsa o günün barkodlu çeklerinin hepsi okutulmuş
 * demektir. Uyarıdır — günü kilitlemeyi engellemez.
 */
function SummaryMatch({ m }: { m: Match }) {
  const range = m.merged ? ` (${dmy(m.from)} – ${dmy(m.to)})` : "";
  const line =
    m.state === "match"
      ? {
          tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
          Icon: CheckCircle2,
          dot: "text-emerald-600",
          text: `Mağaza özetindeki Hediye Çeki ile birebir tutuyor${range}: ${money(m.summary_total ?? 0)} ₺`,
        }
      : m.state === "missing"
        ? {
            tone: "border-amber-200 bg-amber-50 text-amber-900",
            Icon: AlertTriangle,
            dot: "text-amber-600",
            text: `Özette ${money(m.summary_total ?? 0)} ₺ hediye çeki var${range}, okutulan ${money(m.scanned_total)} ₺ — ${money(m.diff)} ₺ okutulmamış.`,
          }
        : m.state === "extra"
          ? {
              tone: "border-amber-200 bg-amber-50 text-amber-900",
              Icon: AlertTriangle,
              dot: "text-amber-600",
              text: `Okutulan ${money(m.scanned_total)} ₺, özette ${money(m.summary_total ?? 0)} ₺${range} — ${money(Math.abs(m.diff))} ₺ fazla. Başka güne ya da mağazaya ait olabilir.`,
            }
          : m.state === "no_row"
            ? {
                tone: "border-border bg-muted/40 text-muted-foreground",
                Icon: Info,
                dot: "text-muted-foreground",
                text: `Mağaza özetinde Hediye Çeki satırı yok${range} — o gün çek kullanılmamış.`,
              }
            : m.state === "no_summary"
              ? {
                  tone: "border-border bg-muted/40 text-muted-foreground",
                  Icon: Info,
                  dot: "text-muted-foreground",
                  text: "Mağaza özeti yüklenince okutulan çeklerle karşılaştırılacak.",
                }
              : {
                  tone: "border-border bg-muted/40 text-muted-foreground",
                  Icon: Info,
                  dot: "text-muted-foreground",
                  text: "Bu günün özeti karşılaştırma eklenmeden önce okunmuş; özeti yeniden analiz edersen karşılaştırılır.",
                };

  return (
    <div className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${line.tone}`}>
      <line.Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${line.dot}`} />
      <span className="leading-relaxed">{line.text}</span>
    </div>
  );
}

/**
 * MAVİ HEDİYE ÇEKİ — yalnız Derimod mağazalarında görünür.
 *
 * Mavi'de 5.000 ₺+ alışveriş yapan müşteriye verilen, Derimod'da harcanan çek.
 * KASAYI ETKİLEMEZ, istatistiktir. Sahibi (16.11.2026): "elle yazma bitti" —
 * günün toplamı artık okutulan çeklerden hesaplanır. Barkodsuz eski çekte
 * yalnız tutar elle girilir; Mavi fişi yine okutulur.
 */
export function MaviGiftVoucherCard({ storeId, date }: { storeId: string; date: string }) {
  const disabled = !storeId || !date;
  const day = trpc.giftVoucher.dayTotal.useQuery({ store_id: storeId, date }, { enabled: !disabled });
  const list = trpc.giftVoucher.list.useQuery(
    { status: "all", from: date, to: date, limit: 50 },
    { enabled: !disabled }
  );
  const mine = (list.data ?? []).filter((r) => r.used_date === date);

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Ticket className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold leading-tight">Mavi Hediye Çeki</div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              Çeki ve müşterinin getirdiği Mavi fişini okut; kademe, süre ve mükerrer kullanım kendiliğinden kontrol
              edilir. Kasayı etkilemez.
            </div>
          </div>
          {day.data && day.data.count > 0 ? (
            <div className="shrink-0 text-right">
              <div className="text-lg font-semibold tabular-nums">{money(day.data.total)} ₺</div>
              <div className="text-xs text-muted-foreground">{day.data.count} çek</div>
            </div>
          ) : null}
        </div>

        {day.data ? <SummaryMatch m={day.data.match} /> : null}

        <div className="mt-4">
          <VoucherScan usedStoreId={storeId} usedDate={date} disabled={disabled} />
        </div>

        {mine.length > 0 ? (
          <ul className="mt-4 space-y-1.5 border-t pt-3 text-sm">
            {mine.map((r) => {
              const m = VOUCHER_STATUS[r.status];
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <m.Icon className={`h-4 w-4 shrink-0 ${m.dot}`} />
                  <span className="font-semibold tabular-nums">{money(r.amount)} ₺</span>
                  <span className="font-mono text-xs text-muted-foreground">{r.barcode ?? "barkodsuz"}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {r.receipt ? `${r.receipt.store_name} · ${money(r.receipt.net_amount)} ₺` : `fiş ${r.receipt_ref}`}
                  </span>
                  {r.reasons.length > 0 ? (
                    <span className="w-full text-xs text-rose-700">{r.reasons.join(" · ")}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
