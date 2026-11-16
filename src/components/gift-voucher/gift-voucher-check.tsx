"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Clock, Loader2, ScanBarcode, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TRY_FMT = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => TRY_FMT.format(n);
const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "—");

const STATUS = {
  ok: { label: "Uygun", cls: "border-emerald-200 bg-emerald-50 text-emerald-900", Icon: CheckCircle2, dot: "text-emerald-600" },
  pending: { label: "Bekliyor", cls: "border-amber-200 bg-amber-50 text-amber-900", Icon: Clock, dot: "text-amber-600" },
  fail: { label: "Uygunsuz", cls: "border-rose-200 bg-rose-50 text-rose-900", Icon: XCircle, dot: "text-rose-600" },
} as const;

export function GiftVoucherCheck() {
  const utils = trpc.useUtils();
  const [voucher, setVoucher] = useState("");
  const [receipt, setReceipt] = useState("");
  const [filter, setFilter] = useState<"all" | "ok" | "pending" | "fail">("all");
  const voucherRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);

  const ready = voucher.trim().length >= 8 && receipt.trim().length >= 6;
  const preview = trpc.giftVoucher.preview.useQuery(
    { voucher_barcode: voucher.trim(), receipt_ref: receipt.trim() },
    { enabled: ready }
  );
  const counts = trpc.giftVoucher.counts.useQuery();
  const list = trpc.giftVoucher.list.useQuery({ status: filter, limit: 100 });

  const save = trpc.giftVoucher.claim.useMutation({
    onSuccess: (r) => {
      toast.success(r.status === "ok" ? "Kaydedildi — çek uygun" : r.status === "pending" ? "Kaydedildi — Mavi dosyası bekleniyor" : "Kaydedildi — UYGUNSUZ olarak işaretlendi");
      setVoucher("");
      setReceipt("");
      voucherRef.current?.focus();
      void utils.giftVoucher.list.invalidate();
      void utils.giftVoucher.counts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const recheck = trpc.giftVoucher.recheck.useMutation({
    onSuccess: (r) => {
      toast.success(r.resolved > 0 ? `${r.resolved} bekleyen çek sonuçlandı` : "Bekleyenlerin durumu değişmedi");
      void utils.giftVoucher.list.invalidate();
      void utils.giftVoucher.counts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // Barkod okuyucu Enter ile biter: çek okununca imleç fişe geçsin.
  useEffect(() => {
    if (voucher.trim().length >= 13) receiptRef.current?.focus();
  }, [voucher]);

  const p = ready ? preview.data : undefined;
  const meta = p ? STATUS[p.check.status] : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Hediye çeki barkodu</Label>
              <Input
                ref={voucherRef}
                autoFocus
                value={voucher}
                onChange={(e) => setVoucher(e.target.value)}
                placeholder="2900500000013"
                className="font-mono text-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mavi fişinin barkodu</Label>
              <Input
                ref={receiptRef}
                value={receipt}
                onChange={(e) => setReceipt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ready && p && !save.isPending) {
                    save.mutate({ voucher_barcode: voucher.trim(), receipt_ref: receipt.trim() });
                  }
                }}
                placeholder="9400000013071137"
                className="font-mono text-lg"
              />
            </div>
          </div>

          {!ready ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <ScanBarcode className="h-4 w-4" />
              Önce çeki, sonra Mavi fişini okut. Sonuç burada çıkar.
            </p>
          ) : preview.isLoading ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Kontrol ediliyor…
            </p>
          ) : p && meta ? (
            <div className={`mt-4 rounded-2xl border p-4 ${meta.cls}`}>
              <div className="flex items-center gap-2 text-base font-semibold">
                <meta.Icon className={`h-5 w-5 ${meta.dot}`} />
                {meta.label}
              </div>
              <div className="mt-2 space-y-1 text-sm">
                {p.voucher ? (
                  <div>
                    Çek: <span className="font-semibold tabular-nums">{money(p.voucher.amount)} ₺</span>{" "}
                    <span className="font-mono text-xs opacity-70">{p.voucher.barcode}</span>
                  </div>
                ) : null}
                {p.receipt ? (
                  <div>
                    Fiş: {p.receipt.store_name} · {dmy(p.receipt.date)} ·{" "}
                    <span className="font-semibold tabular-nums">{money(p.receipt.net_amount)} ₺</span>
                    {p.check.tier ? <> → hak ediş <span className="font-semibold tabular-nums">{money(p.check.entitlement)} ₺</span></> : null}
                  </div>
                ) : null}
                {p.other_vouchers_total > 0 ? (
                  <div>Bu fişe daha önce {money(p.other_vouchers_total)} ₺ çek bağlanmış.</div>
                ) : null}
                {p.check.deadline ? <div>Son kullanma: {dmy(p.check.deadline)}</div> : null}
                {p.check.reasons.map((r) => (
                  <div key={r} className="font-medium">• {r}</div>
                ))}
              </div>
              <Button
                className="mt-4"
                disabled={save.isPending}
                onClick={() => save.mutate({ voucher_barcode: voucher.trim(), receipt_ref: receipt.trim() })}
              >
                {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Kaydet
              </Button>
            </div>
          ) : null}
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
            {k === "all" ? "Hepsi" : STATUS[k].label}
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
                const m = STATUS[r.status];
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <m.Icon className={`h-4 w-4 shrink-0 ${m.dot}`} />
                    <span className="w-24 font-semibold tabular-nums">{money(r.amount)} ₺</span>
                    <span className="font-mono text-xs text-muted-foreground">{r.barcode}</span>
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
                    <span className="text-muted-foreground tabular-nums">{dmy(r.used_date)}</span>
                    {r.reasons.length > 0 ? (
                      <span className="w-full text-xs text-rose-700">{r.reasons.join(" · ")}</span>
                    ) : null}
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
