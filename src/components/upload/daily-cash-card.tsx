"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Coins, Loader2, AlertTriangle, Check } from "lucide-react";
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
 * Müdürün/admin'in elden saydığı günlük nakit girişi.
 * StoreSummary.cash_sales ile otomatik karşılaştırılır — fark çıkarsa
 * kasa eksiklik/fazlalık uyarısı verilir.
 */
export function DailyCashCard({
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

  const { data: existing, isLoading } = trpc.dailyRecord.getReportedCash.useQuery(
    { store_id: storeId, date },
    { enabled: !disabled }
  );

  // Yüklü değeri formuna doldur (sadece bir kez)
  useEffect(() => {
    if (existing && existing.reported_cash_try !== null) {
      const n = num(existing.reported_cash_try);
      setAmount(n.toString());
      setNote(existing.reported_cash_note ?? "");
    } else {
      setAmount("");
      setNote("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.reported_cash_at, storeId, date]);

  const save = trpc.dailyRecord.setReportedCash.useMutation({
    onSuccess: () => {
      toast.success("Günlük nakit kaydedildi");
      utils.dailyRecord.getReportedCash.invalidate({ store_id: storeId, date });
      utils.upload.listForStoreDate.invalidate({ store_id: storeId, date });
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

  const hasExisting = existing?.reported_cash_try !== null && !!existing;

  return (
    <Card className={disabled ? "opacity-50" : ""}>
      <CardContent className="p-5">
        <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-yellow-50 text-yellow-600 mb-3">
          <Coins className="h-6 w-6" />
        </div>
        <div className="font-medium mb-1">Günlük Nakit</div>
        <div className="text-xs text-muted-foreground mb-3">
          {disabled
            ? "Önce mağaza ve tarih seç"
            : "Elden sayılan nakit (OCR yok)"}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="cash-amount" className="text-xs">
              Tutar (TL)
            </Label>
            <Input
              id="cash-amount"
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
            <Label htmlFor="cash-note" className="text-xs">
              Not (opsiyonel)
            </Label>
            <Input
              id="cash-note"
              type="text"
              placeholder="Sabah/akşam shift, sayım notu..."
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

        {hasExisting && existing?.reported_cash_at ? (
          <div className="mt-3 pt-3 border-t text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Check className="h-3 w-3 text-emerald-600" />
            {fmt(num(existing.reported_cash_try))} ₺ ·{" "}
            {formatDistanceToNow(new Date(existing.reported_cash_at), {
              addSuffix: true,
              locale: tr,
            })}
          </div>
        ) : (
          <div className="mt-3 pt-3 border-t text-[11px] text-muted-foreground flex items-start gap-1.5">
            <AlertTriangle className="h-3 w-3 mt-0.5 text-amber-500 shrink-0" />
            Müdür kasayı saymadıysa boş bırak — kasa eksiklik kontrolü
            yapılamaz.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
