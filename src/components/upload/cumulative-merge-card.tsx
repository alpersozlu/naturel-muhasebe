"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Layers, Loader2, Check, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/ui/confirm-dialog";

const DATE_FMT = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const DAY_FMT = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", timeZone: "UTC" });
function fmtDate(iso: string): string {
  return DATE_FMT.format(new Date(`${iso}T00:00:00.000Z`));
}
function fmtDay(iso: string): string {
  return DAY_FMT.format(new Date(`${iso}T00:00:00.000Z`));
}
function shiftDayIso(iso: string, by: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}
const isoOf = (d: string | Date) => new Date(d).toISOString().slice(0, 10);

/**
 * KASA BİRLEŞMESİ (Mavi) — kasa kapatılamadığında bu gün önceki günle
 * birleştirilir. İki durum var; hangisi olduğuna önceki günün mağaza özeti
 * karar verir (mergeGroup.probe), kullanıcı onaylamadan önce görür:
 *
 *  1. KÜMÜLATİF — önceki günün kendi özeti VAR: bu günün özeti önceki günün
 *     satışlarını da içerir; önceki özet düşülür, fark bu günün gerçek satışıdır.
 *  2. BİRLİKTE KAPANIŞ — önceki günün özeti YOK (kasa o gün hiç kapatılamadı,
 *     örn. elektrik kesintisi): günler tek özetle birlikte kapanır. Her günün
 *     fişi / Z'si / nakdi kendi gününe girilir; mağaza özeti ve bayi gün sonu
 *     dosyası son güne yüklenir ve bütün günleri kapsar; "Günü Kilitle"
 *     hepsini birlikte kilitler. (04.10.2026, Mavi Güzelyurt 01–02.10.)
 */
export function CumulativeMergeCard({
  storeId,
  date,
  onJump,
}: {
  storeId: string;
  date: string;
  /** Tarih alanını başka bir güne taşı (birleşik günler arasında geçiş). */
  onJump?: (iso: string) => void;
}) {
  const disabled = !storeId || !date;
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [prevDate, setPrevDate] = useState(() => shiftDayIso(date, -1));

  const { data: existing, isLoading } = trpc.dailyRecord.getCumulativePrev.useQuery(
    { store_id: storeId, date },
    { enabled: !disabled }
  );
  const group = trpc.mergeGroup.getForStoreDate.useQuery({ store_id: storeId, date }, { enabled: !disabled });

  useEffect(() => {
    if (existing?.prev_date) {
      setOpen(true);
      setPrevDate(existing.prev_date);
    } else {
      setOpen(false);
      setPrevDate(shiftDayIso(date, -1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.prev_date, date]);

  const isCumulative = !!existing?.prev_date;
  const isGroup = !!group.data;
  const probe = trpc.mergeGroup.probe.useQuery(
    { store_id: storeId, date, prev_date: prevDate },
    { enabled: !disabled && open && !isCumulative && !isGroup && !!prevDate && prevDate < date }
  );

  const refresh = () => {
    void utils.dailyRecord.getCumulativePrev.invalidate({ store_id: storeId, date });
    void utils.mergeGroup.getForStoreDate.invalidate();
    void utils.mergeGroup.getOpenForStore.invalidate({ store_id: storeId });
    void utils.dailyRecord.reconciliation.invalidate();
    void utils.upload.listForStoreDate.invalidate();
  };

  const save = trpc.dailyRecord.setCumulativePrev.useMutation({
    onSuccess: () => {
      toast.success("Kümülatif kasa birleşmesi ayarlandı");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const clear = trpc.dailyRecord.clearCumulativePrev.useMutation({
    onSuccess: () => {
      toast.success("Birleşme kaldırıldı");
      refresh();
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const createGroup = trpc.mergeGroup.create.useMutation({
    onSuccess: () => {
      toast.success(`Günler birleştirildi — mağaza özeti ve bayi dosyası ${fmtDay(date)} gününe yüklenir`);
      refresh();
    },
    onError: (e) => {
      try {
        const parsed = JSON.parse(e.message);
        if (Array.isArray(parsed) && parsed.length > 0) {
          toast.error(parsed.map((i: { message: string }) => i.message).join(" · "));
          return;
        }
      } catch {
        /* düz mesaj */
      }
      toast.error(e.message);
    },
  });
  const removeGroup = trpc.mergeGroup.delete.useMutation({
    onSuccess: () => {
      toast.success("Birleşme kaldırıldı — günler yeniden ayrı");
      refresh();
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const busy = save.isPending || createGroup.isPending;
  const groupDays = group.data
    ? [...group.data.daily_records].sort((a, b) => (a.merge_index ?? 0) - (b.merge_index ?? 0)).map((d) => isoOf(d.date))
    : [];
  const groupEnd = groupDays[groupDays.length - 1];

  return (
    <Card className={`border-orange-200/70 ${disabled ? "opacity-50" : ""}`}>
      <CardContent className="p-5">
        <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-orange-50 text-orange-600 mb-3">
          <Layers className="h-6 w-6" />
        </div>
        <div className="font-medium mb-1">Kasa Birleşmesi</div>
        <div className="text-xs text-muted-foreground mb-3">
          {disabled
            ? "Önce mağaza ve tarih seç"
            : "Kasa kapatılamadıysa (elektrik kesintisi, sistem arızası) bu günü önceki günle birleştirin."}
        </div>

        {isGroup && groupEnd ? (
          // ── Birlikte kapanış aktif ──
          <div className="space-y-3">
            <div className="rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 text-[11px] text-orange-900 leading-snug">
              <Check className="h-3 w-3 inline mr-1 text-orange-600" />
              Aktif: {fmtDay(groupDays[0]!)} – {fmtDate(groupEnd)} birlikte kapatılıyor. Her günün fişi, Z raporu ve nakdi{" "}
              <span className="font-semibold">kendi gününe</span> girilir; mağaza özeti ve bayi gün sonu dosyası{" "}
              <span className="font-semibold">{fmtDay(groupEnd)}</span> gününe yüklenir ve günlerin hepsini kapsar. O günde
              &quot;Günü Kilitle&quot; hepsini birlikte kilitler.
            </div>
            {onJump ? (
              <div className="flex flex-wrap gap-1.5">
                {groupDays.map((d) => (
                  <Button key={d} size="sm" variant={d === date ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => onJump(d)}>
                    {fmtDay(d)}
                    {d === groupEnd ? " · özet" : ""}
                  </Button>
                ))}
              </div>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="w-full text-rose-600 hover:text-rose-700"
              disabled={removeGroup.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: "Birleşme kaldırılsın mı?",
                    description: "Günler yeniden ayrı ayrı kapatılır; yüklenen belgeler silinmez.",
                    confirmLabel: "Kaldır",
                    destructive: true,
                  })
                ) {
                  removeGroup.mutate({ id: group.data!.id });
                }
              }}
            >
              {removeGroup.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <X className="h-4 w-4 mr-1.5" />}
              Birleşmeyi Kaldır
            </Button>
          </div>
        ) : !open && !isCumulative ? (
          <Button variant="outline" size="sm" className="w-full" disabled={disabled} onClick={() => setOpen(true)}>
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
                max={shiftDayIso(date, -1)}
                onChange={(e) => setPrevDate(e.target.value)}
                disabled={disabled || busy || isCumulative}
              />
            </div>

            {isCumulative ? (
              <div className="rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 text-[11px] text-orange-900 leading-snug">
                <Check className="h-3 w-3 inline mr-1 text-orange-600" />
                Aktif: {fmtDate(date)} özeti kümülatif. {fmtDate(existing!.prev_date!)} satışları otomatik düşülüyor — gerçek satış =
                bugün − önceki gün.
              </div>
            ) : probe.isLoading ? (
              <div className="text-[11px] text-muted-foreground leading-snug">Kontrol ediliyor…</div>
            ) : probe.data?.blocker ? (
              <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[11px] text-rose-800 leading-snug">{probe.data.blocker}</div>
            ) : probe.data?.mode === "cumulative" ? (
              <div className="text-[11px] text-muted-foreground leading-snug">
                {fmtDate(prevDate)} gününün mağaza özeti sistemde var. Bu günün özeti kümülatif sayılır: program {fmtDay(prevDate)} özetini bu
                günden çıkarır, fark bu günün gerçek satışı olur.
              </div>
            ) : probe.data?.mode === "group" ? (
              <div className="rounded-lg bg-orange-50/60 border border-orange-200 px-3 py-2 text-[11px] text-orange-900 leading-snug">
                {fmtDate(prevDate)} gününün mağaza özeti yok (kasa o gün kapatılamadı).{" "}
                <span className="font-semibold">{probe.data.days} gün birlikte kapatılır:</span> her günün fişi, Z raporu ve nakdi kendi gününe
                girilir; mağaza özeti ve bayi gün sonu dosyası yalnız <span className="font-semibold">{fmtDay(date)}</span> gününe yüklenir ve
                günlerin hepsini kapsar.
              </div>
            ) : null}

            <div className="flex gap-2">
              {!isCumulative ? (
                <>
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={disabled || busy || probe.isLoading || !probe.data || !!probe.data.blocker}
                    onClick={() => {
                      if (!probe.data) return;
                      if (probe.data.mode === "cumulative") save.mutate({ store_id: storeId, date, prev_date: prevDate });
                      else createGroup.mutate({ store_id: storeId, start_date: prevDate, end_date: date });
                    }}
                  >
                    {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
                    Onayla
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
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
                  {clear.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <X className="h-4 w-4 mr-1.5" />}
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
