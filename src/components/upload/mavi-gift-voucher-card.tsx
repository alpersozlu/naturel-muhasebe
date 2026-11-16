"use client";

import { Ticket } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { VoucherScan, VOUCHER_STATUS, money } from "@/components/gift-voucher/voucher-scan";

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

        <VoucherScan usedStoreId={storeId} usedDate={date} disabled={disabled} />

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
