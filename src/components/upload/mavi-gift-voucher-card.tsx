"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Ticket, Loader2, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TRY_FORMATTER = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmt(n: number): string {
  return TRY_FORMATTER.format(n);
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "object" && v !== null && "toNumber" in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

/**
 * MAVİ HEDİYE ÇEKİ — sadece Derimod mağazalarında görünür.
 * Mavi'de yüksek alışveriş yapan müşterilere verilen, Derimod'da kullanılan
 * hediye çekleri. KASA İLE ALAKASI YOKTUR — sadece istatistik amaçlı.
 */
export function MaviGiftVoucherCard({
  storeId,
  date,
}: {
  storeId: string;
  date: string;
}) {
  const disabled = !storeId || !date;
  const utils = trpc.useUtils();

  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const { data: existing, isLoading } =
    trpc.dailyRecord.getMaviGiftVoucher.useQuery(
      { store_id: storeId, date },
      { enabled: !disabled }
    );

  useEffect(() => {
    if (existing && existing.mavi_gift_voucher_try !== null) {
      setAmount(num(existing.mavi_gift_voucher_try).toString());
      setNote(existing.mavi_gift_voucher_note ?? "");
    } else {
      setAmount("");
      setNote("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.mavi_gift_voucher_at, storeId, date]);

  const save = trpc.dailyRecord.setMaviGiftVoucher.useMutation({
    onSuccess: () => {
      toast.success("Mavi hediye çeki kaydedildi");
      utils.dailyRecord.getMaviGiftVoucher.invalidate({
        store_id: storeId,
        date,
      });
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      toast.error("Geçerli bir tutar gir");
      return;
    }
    save.mutate({
      store_id: storeId,
      date,
      amount: n,
      note: note.trim() || undefined,
    });
  };

  const hasExisting = existing?.mavi_gift_voucher_try !== null && !!existing;

  return (
    <Card className={`border-blue-200/70 ${disabled ? "opacity-50" : ""}`}>
      <CardContent className="p-5">
        <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-blue-50 text-blue-600 mb-3">
          <Ticket className="h-6 w-6" />
        </div>
        <div className="font-medium mb-1">Mavi Hediye Çeki</div>
        <div className="text-xs text-muted-foreground mb-3">
          {disabled
            ? "Önce mağaza ve tarih seç"
            : "Mavi'den gelen, Derimod'da kullanılan hediye çeki (sadece istatistik — kasayı etkilemez)"}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="mavi-gift-amount" className="text-xs">
              Tutar (TL)
            </Label>
            <Input
              id="mavi-gift-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={disabled || save.isPending}
            />
          </div>

          <div>
            <Label htmlFor="mavi-gift-note" className="text-xs">
              Not (opsiyonel)
            </Label>
            <Input
              id="mavi-gift-note"
              type="text"
              placeholder="Müşteri, kampanya detayı..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={disabled || save.isPending}
              maxLength={300}
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={disabled || save.isPending || isLoading}
          >
            {save.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : hasExisting ? (
              <Check className="h-4 w-4 mr-2" />
            ) : null}
            {hasExisting ? "Güncelle" : "Kaydet"}
          </Button>
        </form>

        {hasExisting && existing?.mavi_gift_voucher_at ? (
          <div className="mt-3 pt-3 border-t text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Check className="h-3 w-3 text-emerald-600" />
            {fmt(num(existing.mavi_gift_voucher_try))} ₺ ·{" "}
            {formatDistanceToNow(new Date(existing.mavi_gift_voucher_at), {
              addSuffix: true,
              locale: tr,
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
