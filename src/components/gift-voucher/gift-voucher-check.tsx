"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { VoucherScan, VOUCHER_STATUS, money, dmy } from "./voucher-scan";

export function GiftVoucherCheck() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<"all" | "ok" | "pending" | "fail">("all");
  const counts = trpc.giftVoucher.counts.useQuery();
  const list = trpc.giftVoucher.list.useQuery({ status: filter, limit: 100 });
  const recheck = trpc.giftVoucher.recheck.useMutation({
    onSuccess: (r) => {
      toast.success(r.resolved > 0 ? `${r.resolved} bekleyen çek sonuçlandı` : "Bekleyenlerin durumu değişmedi");
      void utils.giftVoucher.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <VoucherScan />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "fail", "pending", "ok"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted/50"
            }`}
          >
            {k === "all" ? "Hepsi" : VOUCHER_STATUS[k].label}
            {counts.data && k !== "all" ? ` (${counts.data[k]})` : ""}
          </button>
        ))}
        <div className="flex-1" />
        <Button variant="outline" size="sm" disabled={recheck.isPending} onClick={() => recheck.mutate()}>
          {recheck.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Bekleyenleri yeniden kontrol et
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {list.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Yükleniyor…</div>
          ) : (list.data ?? []).length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Bu süzgeçte kayıt yok.</div>
          ) : (
            <ul className="divide-y text-sm">
              {(list.data ?? []).map((r) => {
                const m = VOUCHER_STATUS[r.status];
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <m.Icon className={`h-4 w-4 shrink-0 ${m.dot}`} />
                    <span className="w-24 font-semibold tabular-nums">{money(r.amount)} ₺</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {r.barcode ?? (r.is_manual ? "barkodsuz" : "—")}
                    </span>
                    <span className="min-w-0 flex-1">
                      {r.receipt ? (
                        <>
                          {r.receipt.store_name} · {dmy(r.receipt.date)} ·{" "}
                          <span className="tabular-nums">{money(r.receipt.net_amount)} ₺</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">fiş {r.receipt_ref} — eşleşmedi</span>
                      )}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{dmy(r.used_date)}</span>
                    {r.used_store ? <span className="text-muted-foreground">{r.used_store}</span> : null}
                    {r.reasons.length > 0 ? <span className="w-full text-xs text-rose-700">{r.reasons.join(" · ")}</span> : null}
                    {r.overridden_at ? (
                      <span className="w-full text-xs text-amber-700">Yönetici onayladı: {r.override_note}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
