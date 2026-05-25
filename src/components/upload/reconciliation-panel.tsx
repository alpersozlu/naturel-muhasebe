"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ShieldCheck,
  Check,
  X,
  AlertTriangle,
  ShieldAlert,
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
              data.has_bank_receipt ||
              data.has_gift_voucher ||
              data.has_expenses
            }
            optional={!data.requires_cash_proof}
            label={
              !data.requires_cash_proof
                ? data.has_summary
                  ? "Nakit Yok (POS-only gün)"
                  : "Nakit Kaynağı (özet bekleniyor)"
                : (() => {
                    const parts: string[] = [];
                    if (data.has_reported_cash) parts.push("Sayım");
                    if (data.has_bank_receipt) parts.push("Dekont");
                    if (data.has_gift_voucher) parts.push("Hediye");
                    if (data.has_expenses) parts.push("Masraf");
                    return parts.length > 0
                      ? `Nakit Kaynağı (${parts.join(" + ")})`
                      : "Nakit Kaynağı (Sayım / Dekont / Hediye / Masraf)";
                  })()
            }
          />
        </div>

        {/* Status banner — incomplete/error/locked durumları */}
        <StatusBanner data={data} />

        {/* SAP Bayi Raporu vs Müdür Özeti — fark uyarı banner'ı (varsa) */}
        {v && v.rows ? <SapAlertBanner rows={v.rows} /> : null}

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

        {/* Action bar — sol açıklama + sağda dikey status/aksiyon paneli */}
        <div className="mt-5 pt-5 border-t flex flex-col sm:flex-row items-stretch gap-4">
          {/* Sol: durum metni + ufak utility butonlar */}
          <div className="flex-1 flex flex-col gap-3 justify-between min-w-0">
            <div className="text-xs text-muted-foreground leading-relaxed">
              {isLocked
                ? "Bu gün kilitli — değişiklik yapılamaz."
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
                variant="ghost"
                className="h-8 px-3"
                onClick={() => {
                  setNotesDirty(false);
                  refetch();
                }}
                disabled={isRefetching}
              >
                {isRefetching ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                <span className="text-xs">Yeniden Mutabakat</span>
              </Button>
              {!isLocked && (v || notesDirty) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-3"
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
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  <span className="text-xs">Notu Kaydet</span>
                </Button>
              ) : null}
            </div>
          </div>

          {/* Sağ: dikey status pill + ana aksiyon butonu */}
          <div className="flex flex-col gap-2 sm:w-60 shrink-0">
            <StatusPill status={data.status} isLocked={isLocked} />
            {canApprove && !isLocked && data.daily_record_id ? (
              <button
                type="button"
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
                className="flex items-center justify-center gap-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-5 py-4 transition-colors shadow-sm"
              >
                {approve.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
                <span>Doğrula ve Kilitle</span>
              </button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Sağ panelin üstündeki büyük status pill — duruma göre renk değişir */
function StatusPill({
  status,
  isLocked,
}: {
  status: ReconData["status"];
  isLocked: boolean;
}) {
  // Locked durumu rengi belirler — kilitli + match birleşik
  if (isLocked) {
    return (
      <div className="rounded-2xl bg-emerald-500 text-white px-5 py-4 flex items-center gap-2.5 shadow-sm">
        <Lock className="h-4 w-4 shrink-0" />
        <span className="font-semibold text-sm leading-tight">
          Gün Doğrulandı ve Kilitlendi
        </span>
      </div>
    );
  }
  if (status === "match") {
    return (
      <div className="rounded-2xl bg-amber-500 text-white px-5 py-4 flex items-center gap-2.5 shadow-sm">
        <Check className="h-4 w-4 shrink-0" />
        <span className="font-semibold text-sm leading-tight">
          Gün Mutabakatı Sağlandı
        </span>
      </div>
    );
  }
  if (status === "mismatch") {
    return (
      <div className="rounded-2xl bg-rose-500 text-white px-5 py-4 flex items-center gap-2.5 shadow-sm">
        <XCircle className="h-4 w-4 shrink-0" />
        <span className="font-semibold text-sm leading-tight">
          Mutabakat Sağlanmadı
        </span>
      </div>
    );
  }
  if (status === "ready") {
    return (
      <div className="rounded-2xl bg-sky-500 text-white px-5 py-4 flex items-center gap-2.5 shadow-sm">
        <Check className="h-4 w-4 shrink-0" />
        <span className="font-semibold text-sm leading-tight">
          Doğrulamaya Hazır
        </span>
      </div>
    );
  }
  if (status === "incomplete") {
    return (
      <div className="rounded-2xl bg-amber-100 text-amber-800 border border-amber-200 px-5 py-4 flex items-center gap-2.5">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="font-semibold text-sm leading-tight">
          Eksik Belge Var
        </span>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="rounded-2xl bg-rose-100 text-rose-800 border border-rose-200 px-5 py-4 flex items-center gap-2.5">
        <XCircle className="h-4 w-4 shrink-0" />
        <span className="font-semibold text-sm leading-tight">
          Yükleme Hatası
        </span>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-slate-100 text-slate-700 border border-slate-200 px-5 py-4 flex items-center gap-2.5">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="font-semibold text-sm leading-tight">
        Henüz Yükleme Yok
      </span>
    </div>
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
  // Nakit kaynak kontrolü (özetteki nakit > 0 ise en az biri zorunlu)
  requires_cash_proof?: boolean;
  has_reported_cash?: boolean;
  has_bank_receipt?: boolean;
  has_gift_voucher?: boolean;
  has_expenses?: boolean;
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
    // Özette nakit varsa nakit kaynağı (sayım/dekont/hediye/masraf) zorunlu
    if (
      data.requires_cash_proof &&
      !data.has_reported_cash &&
      !data.has_bank_receipt &&
      !data.has_gift_voucher &&
      !data.has_expenses
    ) {
      missing.push("Nakit Kaynağı (Sayım / Dekont / Hediye / Masraf)");
    }
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

// ───────────────── SAP Bayi Raporu vs Özet Uyarısı ─────────────────
/**
 * SAP Bayi Raporu yüklendiğinde Mağaza Özeti ile karşılaştırır.
 * Sign konvansiyonu: difference = SAP − özet
 *  - Pozitif → SAP > özet → MÜDÜR ÖZETİ AZ → hırsızlık sinyali (rose)
 *  - Negatif → SAP < özet → MÜDÜR ÖZETİ ŞİŞMİŞ → anomali (amber)
 *  - 0/tolerans → uyumlu (yeşil rozet, dikkat çekmez)
 */
function SapAlertBanner({ rows }: { rows: Row[] }) {
  const netRow = rows.find((r) => r.label === "SAP Net Satış (Bayi Raporu)");
  const loyRow = rows.find((r) => r.label === "SAP Kartuş Puan (Bayi Raporu)");
  if (!netRow && !loyRow) return null; // SAP yüklenmemiş

  const netDiff = netRow?.difference ?? 0;
  const loyDiff = loyRow?.difference ?? 0;
  const allMatch =
    (!netRow || netRow.matches) && (!loyRow || loyRow.matches);

  // Tümü uyumluysa: küçük yeşil bilgilendirme şeridi
  if (allMatch) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-4 py-2.5 flex items-center gap-2.5 text-xs animate-fade-in">
        <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
        <span className="font-medium text-emerald-900">
          SAP Bayi Raporu Mağaza Özeti ile uyumlu
        </span>
        <span className="text-emerald-700/70">— manipülasyon sinyali yok</span>
      </div>
    );
  }

  // En kritik fark hangisi? Pozitif (özet az) > Negatif (özet fazla) önceliği
  const criticalNet = netRow && !netRow.matches && netDiff > 0;
  const criticalLoy = loyRow && !loyRow.matches && loyDiff > 0;
  const isCritical = criticalNet || criticalLoy;

  const tone = isCritical
    ? {
        bar: "border-rose-300 bg-gradient-to-r from-rose-50 to-rose-50/40",
        icon: "text-rose-600",
        title: "text-rose-900",
        Icon: ShieldAlert,
        label: "Manipülasyon Riski",
        explainer:
          "SAP Bayi Raporu Mağaza Özeti'nden YÜKSEK — müdür özeti olduğundan daha az gösterilmiş olabilir.",
      }
    : {
        bar: "border-amber-300 bg-gradient-to-r from-amber-50 to-amber-50/40",
        icon: "text-amber-600",
        title: "text-amber-900",
        Icon: AlertTriangle,
        label: "SAP ↔ Özet Farkı",
        explainer:
          "Mağaza Özeti SAP Bayi Raporu'ndan YÜKSEK — anomali, kontrol edilmeli.",
      };
  const Icon = tone.Icon;

  return (
    <div
      className={`mt-4 rounded-2xl border-2 ${tone.bar} p-4 animate-fade-in shadow-sm`}
    >
      <div className="flex items-start gap-3">
        <div className={`shrink-0 ${tone.icon}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-semibold text-sm ${tone.title}`}>
            🚨 {tone.label}
          </div>
          <div className="text-xs text-foreground/80 mt-1">{tone.explainer}</div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
            {netRow && !netRow.matches ? (
              <SapDiffRow
                label="Net Satış"
                sap={netRow.document_total}
                summary={netRow.summary_total}
                diff={netDiff}
              />
            ) : null}
            {loyRow && !loyRow.matches ? (
              <SapDiffRow
                label="Kartuş Puan"
                sap={loyRow.document_total}
                summary={loyRow.summary_total}
                diff={loyDiff}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SapDiffRow({
  label,
  sap,
  summary,
  diff,
}: {
  label: string;
  sap: number;
  summary: number;
  diff: number;
}) {
  const isShortage = diff > 0; // SAP > özet → özet az → eksik
  const sign = diff > 0 ? "+" : "";
  return (
    <div className="rounded-lg bg-white/80 border border-foreground/5 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </div>
      <div className="flex items-baseline justify-between gap-2 mt-0.5">
        <div className="text-xs text-foreground/70 tabular-nums">
          <span title="SAP Bayi Raporu">{TRY_FMT.format(sap)}</span>
          <span className="text-muted-foreground mx-1">↔</span>
          <span title="Mağaza Özeti">{TRY_FMT.format(summary)}</span>
        </div>
        <div
          className={`text-sm font-semibold tabular-nums ${
            isShortage ? "text-rose-700" : "text-amber-700"
          }`}
        >
          {sign}
          {TRY_FMT.format(diff)} ₺
        </div>
      </div>
      <div
        className={`text-[10px] font-medium mt-0.5 ${
          isShortage ? "text-rose-700" : "text-amber-700"
        }`}
      >
        {isShortage ? "Müdür Özeti az" : "Müdür Özeti fazla"}
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
  z_compliance?: {
    status: "passed" | "below_visa" | "above_sales" | "no_z";
    z_report_total: number;
    manual_invoice_total: number;
    visa_total: number;
    visa_floor: number;
    sales_ceiling: number;
    cash_present: boolean;
  };
  cash_breakdown?: {
    gift_voucher: number;
    expenses: number;
    reported_cash: number;
    bank_receipts: number;
    has_reported_cash: boolean;
    has_bank_receipt: boolean;
    has_gift_voucher: boolean;
    has_expenses: boolean;
  };
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
            const isZ = r.z_compliance !== undefined;
            return (
              <tr
                key={i}
                className={
                  isTotal
                    ? "border-t-2 border-border bg-slate-50/60 font-semibold"
                    : isZ
                      ? "border-t border-border/60 bg-sky-50/30"
                      : "border-t border-border/60"
                }
              >
                <td className="py-2.5 px-3 text-foreground">
                  {r.label}
                  {r.cash_breakdown ? (
                    <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums flex flex-wrap gap-x-2">
                      {r.cash_breakdown.has_reported_cash ? (
                        <span>Sayım: {TRY_FMT.format(r.cash_breakdown.reported_cash)}</span>
                      ) : null}
                      {r.cash_breakdown.has_bank_receipt ? (
                        <span>+ Dekont: {TRY_FMT.format(r.cash_breakdown.bank_receipts)}</span>
                      ) : null}
                      {r.cash_breakdown.has_expenses ? (
                        <span>+ Masraf: {TRY_FMT.format(r.cash_breakdown.expenses)}</span>
                      ) : null}
                      {r.cash_breakdown.has_gift_voucher ? (
                        <span>+ Hediye: {TRY_FMT.format(r.cash_breakdown.gift_voucher)}</span>
                      ) : null}
                      {!r.cash_breakdown.has_reported_cash &&
                      !r.cash_breakdown.has_bank_receipt &&
                      !r.cash_breakdown.has_expenses &&
                      !r.cash_breakdown.has_gift_voucher ? (
                        <span className="text-rose-600 font-medium">
                          ⚠ Hiç kaynak girilmemiş
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {isZ && r.z_compliance ? (
                    <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                      {r.z_compliance.z_report_total > 0
                        ? `Z: ${TRY_FMT.format(r.z_compliance.z_report_total)}`
                        : null}
                      {r.z_compliance.z_report_total > 0 &&
                      r.z_compliance.manual_invoice_total > 0
                        ? " + "
                        : ""}
                      {r.z_compliance.manual_invoice_total > 0
                        ? `El Fat: ${TRY_FMT.format(r.z_compliance.manual_invoice_total)}`
                        : null}
                    </div>
                  ) : null}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums">
                  {TRY_FMT.format(r.document_total)} ₺
                </td>
                <td className="py-2.5 px-1 text-center text-muted-foreground">→</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">
                  {isZ && r.z_compliance ? (
                    <span title="Alt sınır: Visa (nakit varsa ×1.05)">
                      {TRY_FMT.format(r.z_compliance.visa_floor)} ₺
                      <div className="text-[10px] opacity-70">
                        {r.z_compliance.cash_present ? "Visa × 1.05" : "Visa"}
                      </div>
                    </span>
                  ) : (
                    <>{TRY_FMT.format(r.summary_total)} ₺</>
                  )}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums">
                  {isZ ? (
                    <ZFarkBadge diff={r.difference} status={r.z_compliance!.status} />
                  ) : (
                    <KasaFarki diff={r.difference} matches={r.matches} />
                  )}
                </td>
                <td className="py-2.5 px-3 text-right">
                  {isZ && r.z_compliance ? (
                    <ZStatusBadge status={r.z_compliance.status} />
                  ) : (
                    <StatusBadge matches={r.matches} isTotal={isTotal} />
                  )}
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

function ZStatusBadge({
  status,
}: {
  status: "passed" | "below_visa" | "above_sales" | "no_z";
}) {
  if (status === "passed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
        <Check className="h-3 w-3" />
        Uygun
      </span>
    );
  }
  if (status === "below_visa") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
        <AlertTriangle className="h-3 w-3" />
        Visa Altı
      </span>
    );
  }
  if (status === "above_sales") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
        <AlertTriangle className="h-3 w-3" />
        Satış Üstü
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground border border-border">
      Veri Yok
    </span>
  );
}

function ZFarkBadge({
  diff,
  status,
}: {
  diff: number;
  status: "passed" | "below_visa" | "above_sales" | "no_z";
}) {
  if (status === "no_z") {
    return <span className="text-muted-foreground">—</span>;
  }
  const tone =
    status === "passed"
      ? "text-emerald-700"
      : status === "below_visa"
        ? "text-rose-700"
        : "text-amber-700";
  const sign = diff > 0 ? "+" : "";
  return (
    <span className={`${tone} font-medium`}>
      {sign}
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
