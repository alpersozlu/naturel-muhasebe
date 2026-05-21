"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ShieldCheck,
  Check,
  X,
  AlertTriangle,
  Lock,
  Loader2,
  XCircle,
  Save,
  RefreshCw,
  Pencil,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const TRY_FMT = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Gün sonu Mutabakat / Uzlaşma paneli — /upload sayfasının altında durur.
 * Üst kısım: hangi belgeler var/eksik (checklist).
 * Orta kısım: belge tutarı vs mağaza özeti karşılaştırma tablosu + kasa farkı.
 * Alt kısım: notlar (fark açıklaması) + Kaydet + Yeniden + (admin) Kilitle.
 */
export function ReconciliationPanel({
  storeId,
  date,
  canApprove,
}: {
  storeId: string;
  date: string;
  canApprove: boolean;
}) {
  const disabled = !storeId || !date;
  const utils = trpc.useUtils();
  const { data, isLoading, refetch, isRefetching } =
    trpc.dailyRecord.reconciliation.useQuery(
      { store_id: storeId, date },
      { enabled: !disabled, refetchInterval: 5000 }
    );

  const approve = trpc.dailyRecord.approveAndLock.useMutation({
    onSuccess: () => {
      toast.success("Gün onaylandı ve kilitlendi");
      utils.dailyRecord.reconciliation.invalidate({ store_id: storeId, date });
      utils.upload.listForStoreDate.invalidate({ store_id: storeId, date });
    },
    onError: (e) => toast.error(e.message),
  });

  const saveNotes = trpc.dailyRecord.saveReconciliationNotes.useMutation({
    onSuccess: () => {
      toast.success("Notlar kaydedildi");
      utils.dailyRecord.reconciliation.invalidate({ store_id: storeId, date });
    },
    onError: (e) => toast.error(e.message),
  });

  // Local notes state — server'dan gelen notla initialize edilir
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  useEffect(() => {
    if (!notesDirty && data?.reconciliation_notes !== undefined) {
      setNotes(data?.reconciliation_notes ?? "");
    }
  }, [data?.reconciliation_notes, notesDirty]);

  if (disabled || isLoading || !data) {
    return null;
  }

  const isLocked = data.daily_record_status === "locked";
  const v = data.verification;

  return (
    <Card className="mt-6 border-primary/30">
      <CardContent className="p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="text-base font-semibold leading-tight">
              Gün Uzlaşması
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              Yüklenen belgeleri Mağaza Özeti ile karşılaştır — kasa farkını
              tespit et.
            </div>
          </div>
        </div>

        {/* Checklist */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
          <CheckItem
            ok={data.has_z}
            label={
              data.has_z_report && data.has_manual_invoice
                ? "Z Raporu + El Faturası"
                : data.has_z_report
                  ? "Z Raporu"
                  : data.has_manual_invoice
                    ? "El Faturası (Z yerine)"
                    : "Z Raporu veya El Faturası"
            }
          />
          <CheckItem
            ok={data.pos_count > 0}
            label={
              data.pos_count > 0
                ? `${data.pos_count} POS Fişi`
                : "POS Fişi (en az 1)"
            }
          />
          <CheckItem ok={data.has_summary} label="Mağaza Özeti" />
          <CheckItem
            ok={
              !data.requires_cash_proof ||
              data.has_reported_cash ||
              data.has_bank_receipt
            }
            optional={!data.requires_cash_proof}
            label={
              !data.requires_cash_proof
                ? data.has_summary
                  ? "Nakit Yok (POS-only gün)"
                  : "Günlük Nakit (özet bekleniyor)"
                : data.has_bank_receipt
                  ? "İban Dekontu"
                  : data.has_reported_cash
                    ? "Günlük Nakit"
                    : "Günlük Nakit / İban Dekontu"
            }
          />
        </div>

        {/* Status banner — incomplete/error/locked durumları */}
        <StatusBanner data={data} />

        {/* Comparison table — sadece verification varsa */}
        {v && v.rows && v.rows.length > 0 ? (
          <ComparisonTable rows={v.rows} difference={v.difference} />
        ) : null}

        {/* Notes — sadece tablo gösteriliyorsa veya kilitli notlar varsa */}
        {(v || data.reconciliation_notes) ? (
          <div className="mt-5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Pencil className="h-3.5 w-3.5" />
              Mutabakat Notu
              {data.reconciliation_notes_at ? (
                <span className="text-[10px] text-muted-foreground/70 normal-case font-normal tracking-normal ml-1">
                  · son güncelleme{" "}
                  {new Date(data.reconciliation_notes_at).toLocaleString("tr-TR", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              ) : null}
            </label>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setNotesDirty(true);
              }}
              placeholder={
                v && Math.abs(v.difference) > 1
                  ? "Farkı açıkla: örn. müşteri fazla nakit verdi, üstü unutuldu; POS terminali iade yaptı; vb."
                  : "Bu gün için not (opsiyonel)..."
              }
              rows={2}
              disabled={isLocked && !canApprove}
              className="mt-2 w-full text-sm rounded-lg border border-input bg-background px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        ) : null}

        {/* Action bar */}
        <div className="mt-5 pt-5 border-t flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground flex-1 min-w-[200px]">
            {isLocked
              ? "Bu gün kilitli."
              : data.status === "match"
                ? "Tüm kalemler tutuyor — onaylamaya hazır."
                : data.status === "mismatch"
                  ? "Fark var. Notla açıklayıp kaydedebilir, admin onayına bırakabilirsin."
                  : data.status === "incomplete"
                    ? "Eksik belgeler tamamlanınca mutabakat hesaplanır."
                    : "Doğrulamaya hazır."}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setNotesDirty(false);
                refetch();
              }}
              disabled={isRefetching}
            >
              {isRefetching ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1.5" />
              )}
              Yeniden Mutabakat
            </Button>
            {!isLocked && (v || notesDirty) ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  saveNotes.mutate(
                    { store_id: storeId, date, notes },
                    {
                      onSuccess: () => setNotesDirty(false),
                    }
                  );
                }}
                disabled={saveNotes.isPending || !notesDirty}
              >
                {saveNotes.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-1.5" />
                )}
                Notu Kaydet
              </Button>
            ) : null}
            {canApprove && !isLocked && data.daily_record_id ? (
              <Button
                size="sm"
                onClick={() => {
                  // Önce notu kaydet (varsa), sonra kilitle
                  if (notesDirty) {
                    saveNotes.mutate(
                      { store_id: storeId, date, notes },
                      {
                        onSuccess: () => {
                          setNotesDirty(false);
                          approve.mutate({ id: data.daily_record_id! });
                        },
                      }
                    );
                  } else {
                    approve.mutate({ id: data.daily_record_id! });
                  }
                }}
                disabled={
                  approve.isPending ||
                  saveNotes.isPending ||
                  !data.has_summary
                }
                className="bg-slate-900 hover:bg-slate-800"
              >
                {approve.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Lock className="h-4 w-4 mr-1.5" />
                )}
                Onayla ve Kilitle
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CheckItem({
  ok,
  label,
  optional,
}: {
  ok: boolean;
  label: string;
  optional?: boolean;
}) {
  const cls = optional
    ? "bg-slate-50 text-slate-600"
    : ok
      ? "bg-emerald-50 text-emerald-800"
      : "bg-muted/30 text-muted-foreground";
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${cls}`}
    >
      {ok ? <Check className="h-4 w-4 shrink-0" /> : <X className="h-4 w-4 shrink-0" />}
      <span className="truncate">{label}</span>
    </div>
  );
}

type ReconData = {
  status:
    | "empty"
    | "incomplete"
    | "ready"
    | "match"
    | "mismatch"
    | "locked"
    | "error";
  failed_count: number;
  has_z: boolean;
  has_z_report: boolean;
  has_manual_invoice: boolean;
  has_summary: boolean;
  pos_count: number;
  verification: {
    status: "match" | "mismatch" | "no_data" | "no_summary";
    expected_total: number;
    actual_total: number;
    difference: number;
    notes: string | null;
  } | null;
};

function StatusBanner({ data }: { data: ReconData }) {
  if (data.status === "empty") {
    return (
      <Banner
        tone="muted"
        icon={<AlertTriangle className="h-4 w-4" />}
        title="Henüz yükleme yok"
        message="Bu güne henüz hiçbir belge yüklenmemiş."
      />
    );
  }
  if (data.status === "incomplete") {
    const missing: string[] = [];
    if (!data.has_summary) missing.push("Mağaza Özeti");
    if (!data.has_z) missing.push("Z Raporu veya El Faturası");
    if (data.pos_count === 0) missing.push("POS Fişi");
    return (
      <Banner
        tone="amber"
        icon={<AlertTriangle className="h-4 w-4" />}
        title="Eksik var"
        message={
          missing.length > 0
            ? `Eksik: ${missing.join(", ")}. Bunlar yüklenince mutabakat hesaplanır.`
            : "Mutabakat için zorunlu kalemler tamamlanmalı."
        }
      />
    );
  }
  if (data.status === "error") {
    return (
      <Banner
        tone="rose"
        icon={<XCircle className="h-4 w-4" />}
        title={`${data.failed_count} hatalı yükleme`}
        message="Başarısız olan yüklemeleri kontrol et veya yeniden yükle."
      />
    );
  }
  if (data.status === "locked") {
    return (
      <Banner
        tone="slate"
        icon={<Lock className="h-4 w-4" />}
        title="Gün kilitli"
        message="Bu gün admin tarafından kilitlenmiş, değişiklik yapılamaz."
      />
    );
  }
  return null;
}

function Banner({
  tone,
  icon,
  title,
  message,
}: {
  tone: "emerald" | "rose" | "amber" | "muted" | "slate";
  icon: React.ReactNode;
  title: string;
  message: string;
}) {
  const cls = {
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
    rose: "bg-rose-50 border-rose-200 text-rose-800",
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    muted: "bg-muted/30 border-border text-muted-foreground",
    slate: "bg-slate-100 border-slate-300 text-slate-700",
  }[tone];

  return (
    <div className={`rounded-lg border px-4 py-3 flex items-start gap-2.5 ${cls}`}>
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs mt-0.5 leading-relaxed">{message}</div>
      </div>
    </div>
  );
}

// ───────────────── Comparison Table ─────────────────

type Row = {
  label: string;
  document_total: number;
  summary_total: number;
  difference: number;
  matches: boolean;
};

function ComparisonTable({
  rows,
  difference: dayDiff,
}: {
  rows: Row[];
  difference: number;
}) {
  return (
    <div className="mt-4 rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="text-left font-medium py-2 px-3">Belge Türü</th>
            <th className="text-right font-medium py-2 px-3">Belge Tutarı</th>
            <th className="py-2 px-1 w-6"></th>
            <th className="text-right font-medium py-2 px-3">Mağaza Özeti</th>
            <th className="text-right font-medium py-2 px-3">Kasa Farkı</th>
            <th className="text-right font-medium py-2 px-3 w-24">Durum</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isTotal = r.label === "GENEL TOPLAM";
            return (
              <tr
                key={i}
                className={
                  isTotal
                    ? "border-t-2 border-border bg-slate-50/60 font-semibold"
                    : "border-t border-border/60"
                }
              >
                <td className="py-2.5 px-3 text-foreground">{r.label}</td>
                <td className="py-2.5 px-3 text-right tabular-nums">
                  {TRY_FMT.format(r.document_total)} ₺
                </td>
                <td className="py-2.5 px-1 text-center text-muted-foreground">→</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">
                  {TRY_FMT.format(r.summary_total)} ₺
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums">
                  <KasaFarki diff={r.difference} matches={r.matches} />
                </td>
                <td className="py-2.5 px-3 text-right">
                  <StatusBadge matches={r.matches} isTotal={isTotal} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Toplam kasa farkı vurgusu */}
      <ToplamKasaFarkiFooter difference={dayDiff} />
    </div>
  );
}

function KasaFarki({ diff, matches }: { diff: number; matches: boolean }) {
  if (Math.abs(diff) < 0.01) {
    return <span className="text-emerald-600">0,00 ₺</span>;
  }
  const positive = diff > 0;
  const tone = matches
    ? "text-emerald-600"
    : positive
      ? "text-emerald-700"
      : "text-rose-700";
  return (
    <span className={`${tone} font-medium`}>
      {positive ? "+" : ""}
      {TRY_FMT.format(diff)} ₺
    </span>
  );
}

function StatusBadge({
  matches,
  isTotal,
}: {
  matches: boolean;
  isTotal?: boolean;
}) {
  if (matches) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
        <Check className="h-3 w-3" />
        Eşleşti
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${
        isTotal
          ? "bg-rose-50 text-rose-700 border-rose-200"
          : "bg-amber-50 text-amber-700 border-amber-200"
      }`}
    >
      <XCircle className="h-3 w-3" />
      Eşleşmiyor
    </span>
  );
}

function ToplamKasaFarkiFooter({ difference }: { difference: number }) {
  const TOLERANCE = 5;
  const abs = Math.abs(difference);
  if (abs <= TOLERANCE) {
    return (
      <div className="bg-emerald-50/60 border-t border-emerald-200/60 px-4 py-2.5 text-xs flex items-center justify-between">
        <span className="text-emerald-800 font-medium">
          ✓ Toplam Kasa Farkı (tolerans içinde)
        </span>
        <span className="tabular-nums text-emerald-700 font-semibold">
          {difference >= 0 ? "+" : ""}
          {TRY_FMT.format(difference)} ₺
        </span>
      </div>
    );
  }
  const positive = difference > 0;
  return (
    <div
      className={`border-t px-4 py-2.5 text-xs flex items-center justify-between ${
        positive
          ? "bg-amber-50 border-amber-200 text-amber-900"
          : "bg-rose-50 border-rose-200 text-rose-900"
      }`}
    >
      <span className="font-medium">
        {positive
          ? "↑ Toplam Kasa Farkı (FAZLA — belgelerimiz özetten fazla)"
          : "↓ Toplam Kasa Farkı (EKSİK — özette belgelerimizden fazla satış görünüyor)"}
      </span>
      <span className="tabular-nums font-semibold text-base">
        {positive ? "+" : ""}
        {TRY_FMT.format(difference)} ₺
      </span>
    </div>
  );
}
