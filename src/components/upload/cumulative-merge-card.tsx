"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Layers, Loader2, Check, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DATE_FMT = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});
function fmtDate(iso: string): string {
  return DATE_FMT.format(new Date(`${iso}T00:00:00.000Z`));
}
function prevDayIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * KÜMÜLATİF KASA BİRLEŞMESİ (Mavi).
 * Kasa kapatılmadığı için bu günün mağaza özeti önceki günün satışlarını da
 * içeriyorsa: gerçek bugün = bu özet − önceki gün özeti. Sistem otomatik çıkarır.
 */
export function CumulativeMergeCard({
  storeId,
  date,
}: {
  storeId: string;
  date: string;
}) {
  const disabled = !storeId || !date;
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [prevDate, setPrevDate] = useState(() => prevDayIso(date));

  const { data: existing, isLoading } =
    trpc.dailyRecord.getCumulativePrev.useQuery(
      { store_id: storeId, date },
      { enabled: !disabled }
    );

  useEffect(() => {
    if (existing?.prev_date) {
      setOpen(true);
      setPrevDate(existing.prev_date);
    } else {
      setOpen(false);
      setPrevDate(prevDayIso(date));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.prev_date, date]);

  const save = trpc.dailyRecord.setCumulativePrev.useMutation({
    onSuccess: () => {
      toast.success("Kümülatif kasa birleşmesi ayarlandı");
      utils.dailyRecord.getCumulativePrev.invalidate({ store_id: storeId, date });
      utils.dailyRecord.reconciliation.invalidate({ store_id: storeId, date });
    },
    onError: (e) => toast.error(e.message),
  });
  const clear = trpc.dailyRecord.clearCumulativePrev.useMutation({
    onSuccess: () => {
      toast.success("Birleşme kaldırıldı");
      utils.dailyRecord.getCumulativePrev.invalidate({ store_id: storeId, date });
      utils.dailyRecord.reconciliation.invalidate({ store_id: storeId, date });
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const isActive = !!existing?.prev_date;

  return (
    <Card className={`border-orange-200/70 ${disabled ? "opacity-50" : ""}`}>
      <CardContent className="p-5">
        <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-orange-50 text-orange-600 mb-3">
          <Layers className="h-6 w-6" />
        </div>
        <div className="font-medium mb-1">Kasa Birleşmesi (Kümülatif)</div>
        <div className="text-xs text-muted-foreground mb-3">
          {disabled
            ? "Önce mağaza ve tarih seç"
            : "Kasa kapatılmadıysa: bu günün özeti önceki günü de içerir. Önceki gün düşülerek gerçek satış bulunur."}
        </div>

        {!open && !isActive ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={disabled}
            onClick={() => setOpen(true)}
          >
            Kasa birleşmesi oldu
          </Button>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="prev-date" className="text-xs">
                Hangi günle birleşti? (önceki gün)
              </Label>
              <Input
                id="prev-date"
                type="date"
                value={prevDate}
                max={prevDayIso(date)}
                onChange={(e) => setPrevDate(e.target.value)}
                disabled={disabled || save.isPending || isActive}
              />
            </div>

            {isActive ? (
              <div className="rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 text-[11px] text-orange-900 leading-snug">
                <Check className="h-3 w-3 inline mr-1 text-orange-600" />
                Aktif: {fmtDate(date)} özeti kümülatif. {fmtDate(existing!.prev_date!)} satışları
                otomatik düşülüyor — gerçek satış = bugün − önceki gün.
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground leading-snug">
                Mağaza özetini yükleyince program {fmtDate(prevDate)} özetini bu
                günden çıkaracak ve farkı bu günün gerçek satışı sayacak.
              </div>
            )}

            <div className="flex gap-2">
              {!isActive ? (
                <>
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={disabled || save.isPending}
                    onClick={() =>
                      save.mutate({
                        store_id: storeId,
                        date,
                        prev_date: prevDate,
                      })
                    }
                  >
                    {save.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4 mr-1.5" />
                    )}
                    Onayla
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setOpen(false)}
                    disabled={save.isPending}
                  >
                    Vazgeç
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-rose-600 hover:text-rose-700"
                  disabled={clear.isPending || isLoading}
                  onClick={() => clear.mutate({ store_id: storeId, date })}
                >
                  {clear.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <X className="h-4 w-4 mr-1.5" />
                  )}
                  Birleşmeyi Kaldır
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
