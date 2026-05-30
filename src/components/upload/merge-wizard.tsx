"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Receipt,
  FileText,
  Building,
  Calculator,
  CalendarRange,
  Check,
  ArrowRight,
  Trash2,
  Loader2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { UploadCard } from "./upload-card";
import { CashAdvanceCard } from "./cash-advance-card";
import { DailyCashCard } from "./daily-cash-card";
import { ManualInvoiceCard } from "./manual-invoice-card";
import { MasrafFaturaCard } from "./masraf-fatura-card";
import { GiftVoucherCard } from "./gift-voucher-card";
import { MaviGiftVoucherCard } from "./mavi-gift-voucher-card";
import { UploadList } from "./upload-list";
import { ReconciliationPanel } from "./reconciliation-panel";

const DATE_FMT = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

function fmtDate(iso: string): string {
  return DATE_FMT.format(new Date(`${iso}T00:00:00.000Z`));
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

type GroupDay = {
  id: string;
  date: string; // YYYY-MM-DD
  merge_index: number;
  isLast: boolean;
};

/**
 * Gün Birleşmesi Sihirbazı (Derimod).
 * 1) Aralık seç (başlangıç-bitiş, max 3 gün) → grup oluştur
 * 2) 1. gün paneli → "Bu günü tamamladım" → 2. gün → ...
 * 3) Son günde mağaza özeti kartı + grup uzlaşması görünür
 */
export function MergeWizard({
  storeId,
  isAdmin,
}: {
  storeId: string;
  isAdmin: boolean;
}) {
  const utils = trpc.useUtils();
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState(todayIso());
  // Aktif grup (oluşturulduktan sonra)
  const [days, setDays] = useState<GroupDay[] | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);

  const create = trpc.mergeGroup.create.useMutation({
    onSuccess: async () => {
      // Oluşturulan grubu çek (günleriyle)
      const grp = await utils.mergeGroup.getForStoreDate.fetch({
        store_id: storeId,
        date: start,
      });
      if (!grp) {
        toast.error("Grup oluşturuldu ama yüklenemedi");
        return;
      }
      const sorted = [...grp.daily_records].sort(
        (a, b) => (a.merge_index ?? 0) - (b.merge_index ?? 0)
      );
      const mapped: GroupDay[] = sorted.map((d, i) => ({
        id: d.id,
        date: new Date(d.date).toISOString().slice(0, 10),
        merge_index: d.merge_index ?? i + 1,
        isLast: i === sorted.length - 1,
      }));
      setDays(mapped);
      setGroupId(grp.id);
      setActiveStep(0);
      toast.success(`${mapped.length} günlük birleşme başlatıldı`);
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

  const del = trpc.mergeGroup.delete.useMutation({
    onSuccess: () => {
      toast.success("Birleşme iptal edildi");
      setDays(null);
      setGroupId(null);
      setActiveStep(0);
    },
    onError: (e) => toast.error(e.message),
  });

  const dayCount = (() => {
    const s = new Date(`${start}T00:00:00.000Z`);
    const e = new Date(`${end}T00:00:00.000Z`);
    if (e < s) return 0;
    return Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
  })();

  // ── Kurulum ekranı: aralık seçimi ──
  if (!days || !groupId) {
    return (
      <Card className="border-violet-200/70">
        <CardContent className="p-6">
          <div className="flex items-start gap-3 mb-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 text-violet-600 shrink-0">
              <CalendarRange className="h-6 w-6" />
            </div>
            <div>
              <div className="font-semibold">Gün Birleşmesi (Derimod)</div>
              <div className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
                Birden fazla günü tek mağaza özetiyle uzlaştır. Her gün kendi
                fiş/Z/nakit/masrafını ayrı girersin; mağaza özeti son güne
                yüklenir ve tüm aralığı kapsar. (En fazla 3 gün)
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Başlangıç Tarihi</Label>
              <Input
                type="date"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  if (e.target.value > end) setEnd(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bitiş Tarihi</Label>
              <Input
                type="date"
                value={end}
                min={start}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
            <Button
              onClick={() =>
                create.mutate({ store_id: storeId, start_date: start, end_date: end })
              }
              disabled={
                !storeId ||
                create.isPending ||
                dayCount < 2 ||
                dayCount > 3
              }
            >
              {create.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CalendarRange className="h-4 w-4 mr-2" />
              )}
              Birleşmeyi Başlat
            </Button>
          </div>

          <div className="text-xs mt-3">
            {dayCount < 2 ? (
              <span className="text-amber-600">
                En az 2 gün seçilmeli (tek gün için normal akışı kullan).
              </span>
            ) : dayCount > 3 ? (
              <span className="text-rose-600">En fazla 3 gün birleştirilebilir.</span>
            ) : (
              <span className="text-violet-700">
                {dayCount} gün birleştirilecek: {fmtDate(start)} → {fmtDate(end)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Sihirbaz: gün adımları ──
  const active = days[activeStep]!;
  const allDone = activeStep >= days.length - 1;

  return (
    <div className="space-y-5">
      {/* Adım göstergesi */}
      <Card className="border-violet-200/70">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {days.map((d, i) => {
                const isActive = i === activeStep;
                const isDone = i < activeStep;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setActiveStep(i)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-violet-600 text-white"
                        : isDone
                          ? "bg-violet-100 text-violet-700"
                          : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {isDone ? <Check className="h-3 w-3" /> : null}
                    {d.merge_index}. Gün · {fmtDate(d.date).replace(/ \d{4}$/, "")}
                    {d.isLast ? " (özet)" : ""}
                  </button>
                );
              })}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
              onClick={() => {
                if (confirm("Birleşmeyi iptal et? Günlerin merge bağı kaldırılır.")) {
                  del.mutate({ id: groupId });
                }
              }}
              disabled={del.isPending}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Birleşmeyi İptal Et
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Aktif gün başlığı */}
      <div className="flex items-center justify-between gap-3 flex-wrap px-1">
        <div>
          <div className="text-lg font-semibold">
            {active.merge_index}. Gün — {fmtDate(active.date)}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {active.isLast
              ? "Son gün: bu güne mağaza özetini de yükle (tüm aralığı kapsar)"
              : "Bu günün fiş / Z / nakit / masraf girişlerini yap, sonra sonraki güne geç"}
          </div>
        </div>
        {!allDone ? (
          <Button onClick={() => setActiveStep((s) => s + 1)}>
            Bu günü tamamladım
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        ) : null}
      </div>

      {/* Gün kartları (mağaza özeti SADECE son günde) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <UploadCard
          type="z_report"
          label="Z Raporu"
          icon={Calculator}
          iconBg="bg-cyan-50"
          iconColor="text-cyan-600"
          storeId={storeId}
          date={active.date}
        />
        <UploadCard
          type="pos_slip"
          label="POS Fişi"
          icon={Receipt}
          iconBg="bg-purple-50"
          iconColor="text-purple-600"
          storeId={storeId}
          date={active.date}
          multiple
        />
        {active.isLast ? (
          <UploadCard
            type="store_summary"
            label="Mağaza Özeti (Aralık)"
            icon={FileText}
            iconBg="bg-amber-50"
            iconColor="text-amber-600"
            storeId={storeId}
            date={active.date}
          />
        ) : null}
        <UploadCard
          type="bank_receipt"
          label="İban Dekontu"
          icon={Building}
          iconBg="bg-blue-50"
          iconColor="text-blue-600"
          storeId={storeId}
          date={active.date}
        />
        <DailyCashCard storeId={storeId} date={active.date} />
        <GiftVoucherCard storeId={storeId} date={active.date} />
        <ManualInvoiceCard storeId={storeId} date={active.date} />
        <CashAdvanceCard storeId={storeId} date={active.date} />
        <MasrafFaturaCard storeId={storeId} date={active.date} />
        <MaviGiftVoucherCard storeId={storeId} date={active.date} />
      </div>

      {/* Bu güne ait yüklemeler */}
      <UploadList storeId={storeId} date={active.date} />

      {/* Grup uzlaşması — son günde mağaza özetiyle */}
      {active.isLast ? (
        <ReconciliationPanel
          storeId={storeId}
          date={active.date}
          canApprove={isAdmin}
        />
      ) : (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground text-center">
            Grup uzlaşması son günde (mağaza özeti yüklenince) hesaplanır.
            Önce tüm günlerin girişlerini tamamla.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
