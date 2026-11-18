"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Clock, Loader2, ScanBarcode, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TRY_FMT = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n: number) => TRY_FMT.format(n);
export const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "—");

export const VOUCHER_STATUS = {
  ok: { label: "Uygun", cls: "border-emerald-200 bg-emerald-50 text-emerald-900", Icon: CheckCircle2, dot: "text-emerald-600" },
  pending: { label: "Bekliyor", cls: "border-amber-200 bg-amber-50 text-amber-900", Icon: Clock, dot: "text-amber-600" },
  fail: { label: "Uygunsuz", cls: "border-rose-200 bg-rose-50 text-rose-900", Icon: XCircle, dot: "text-rose-600" },
} as const;

/**
 * ÇEK OKUTMA KUTUSU — hem Yükle ve Analiz'deki günlük kartta hem de Hediye
 * Çeki Kontrolü sayfasında aynısı kullanılır (sahibi, 16.11.2026: "elle yazma
 * bitti; barkodsuzlarda sadece tutar yazılacak ama Mavi fişi yine okutulacak").
 *
 * `usedStoreId` / `usedDate` verilirse çek o mağazanın o gününe yazılır ve
 * günün Mavi hediye çeki toplamı kendiliğinden güncellenir.
 */
export function VoucherScan({
  usedStoreId,
  usedDate,
  disabled,
  onSaved,
}: {
  usedStoreId?: string;
  usedDate?: string;
  disabled?: boolean;
  onSaved?: () => void;
}) {
  const utils = trpc.useUtils();
  const [voucher, setVoucher] = useState("");
  const [receipt, setReceipt] = useState("");
  const [noBarcode, setNoBarcode] = useState(false);
  const [manualAmount, setManualAmount] = useState("");
  const voucherRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);

  const manualNum = Number(manualAmount.replace(",", "."));
  const manualOk = noBarcode && Number.isFinite(manualNum) && manualNum > 0;
  const ready = !disabled && (noBarcode ? manualOk : voucher.trim().length >= 8) && receipt.trim().length >= 6;
  const payload = {
    voucher_barcode: noBarcode ? null : voucher.trim(),
    manual_amount: noBarcode ? manualNum : null,
    receipt_ref: receipt.trim(),
    used_store_id: usedStoreId ?? null,
    used_date: usedDate ?? null,
  };
  const preview = trpc.giftVoucher.preview.useQuery(payload, { enabled: ready });

  const save = trpc.giftVoucher.claim.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.status === "ok"
          ? "Çek kaydedildi — uygun"
          : r.status === "pending"
            ? "Çek kaydedildi — Mavi dosyası bekleniyor"
            : "Çek kaydedildi — UYGUNSUZ olarak işaretlendi"
      );
      setVoucher("");
      setReceipt("");
      setManualAmount("");
      voucherRef.current?.focus();
      void utils.giftVoucher.invalidate();
      if (usedStoreId && usedDate) {
        void utils.dailyRecord.getMaviGiftVoucher.invalidate({ store_id: usedStoreId, date: usedDate });
        void utils.dailyRecord.entriesForStoreDate.invalidate({ store_id: usedStoreId, date: usedDate });
      }
      onSaved?.();
    },
    onError: (e) => toast.error(e.message),
  });

  // Barkod okuyucu Enter'la biter: çek okununca imleç fişe geçsin.
  useEffect(() => {
    if (!noBarcode && voucher.trim().length >= 13) receiptRef.current?.focus();
  }, [voucher, noBarcode]);

  const p = ready ? preview.data : undefined;
  const meta = p ? VOUCHER_STATUS[p.check.status] : null;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">{noBarcode ? "Çekin tutarı (barkodsuz eski çek)" : "Hediye çeki barkodu"}</Label>
            <button type="button" onClick={() => setNoBarcode((v) => !v)} className="text-xs font-medium text-primary hover:underline">
              {noBarcode ? "Barkodlu çek" : "Barkodsuz eski çek"}
            </button>
          </div>
          {noBarcode ? (
            <Input value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} placeholder="500" inputMode="decimal" className="text-lg tabular-nums" disabled={disabled} />
          ) : (
            <Input
              ref={voucherRef}
              value={voucher}
              onChange={(e) => setVoucher(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="2900500000013"
              className="font-mono text-lg"
              disabled={disabled}
            />
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Mavi fişinin barkodu (Fatura No)</Label>
          <Input
            ref={receiptRef}
            value={receipt}
            onChange={(e) => setReceipt(e.target.value)}
            // Kutuya gelince içindeki eski yazı seçilir: okuyucu yeni numarayı
            // eskisinin ARKASINA eklemez, yerine yazar (18.11.2026 Mağusa).
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ready && p && !save.isPending) save.mutate(payload);
            }}
            placeholder="9400000013071137"
            className="font-mono text-lg"
            disabled={disabled}
          />
        </div>
      </div>

      {!ready ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ScanBarcode className="h-4 w-4" />
          {noBarcode ? "Tutarı yazıp Mavi fişini okut." : "Önce çeki, sonra Mavi fişini okut."} Sonuç burada çıkar.
        </p>
      ) : preview.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Kontrol ediliyor…
        </p>
      ) : p && meta ? (
        <div className={`rounded-2xl border p-4 ${meta.cls}`}>
          <div className="flex items-center gap-2 text-base font-semibold">
            <meta.Icon className={`h-5 w-5 ${meta.dot}`} />
            {meta.label}
          </div>
          <div className="mt-2 space-y-1 text-sm">
            {p.voucher ? (
              <div>
                Çek: <span className="font-semibold tabular-nums">{money(p.voucher.amount)} ₺</span>{" "}
                {p.voucher.barcode ? <span className="font-mono text-xs opacity-70">{p.voucher.barcode}</span> : <span className="text-xs opacity-70">barkodsuz</span>}
              </div>
            ) : null}
            {p.receipt ? (
              <div>
                Fiş: {p.receipt.store_name} · {dmy(p.receipt.date)} ·{" "}
                <span className="font-semibold tabular-nums">{money(p.receipt.net_amount)} ₺</span>
                {p.check.tier ? <> → hak ediş <span className="font-semibold tabular-nums">{money(p.check.entitlement)} ₺</span></> : null}
              </div>
            ) : null}
            {p.other_vouchers_total > 0 ? <div>Bu fişe daha önce {money(p.other_vouchers_total)} ₺ çek bağlanmış.</div> : null}
            {p.check.unlimited ? (
              <div>27.07.2026 öncesi alışveriş — çek <span className="font-semibold">süresiz</span>.</div>
            ) : p.check.deadline ? (
              <div>Son kullanma: {dmy(p.check.deadline)}</div>
            ) : null}
            {p.check.reasons.map((r) => (
              <div key={r} className="font-medium">• {r}</div>
            ))}
          </div>
          <Button className="mt-4" disabled={save.isPending} onClick={() => save.mutate(payload)}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Kaydet
          </Button>
        </div>
      ) : null}
    </div>
  );
}
