"use client";

import { toast } from "sonner";
import {
  ShieldCheck,
  Check,
  X,
  AlertTriangle,
  Lock,
  Loader2,
  XCircle,
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
 * Hangi belgeler var/eksik, mutabakat durumu ve onay aksiyonu burada.
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
  const { data, isLoading } = trpc.dailyRecord.reconciliation.useQuery(
    { store_id: storeId, date },
    {
      enabled: !disabled,
      refetchInterval: 5000, // güncel kalsın (upload sonrası otomatik tazele)
    }
  );

  const approve = trpc.dailyRecord.approveAndLock.useMutation({
    onSuccess: () => {
      toast.success("Gün onaylandı ve kilitlendi");
      utils.dailyRecord.reconciliation.invalidate({ store_id: storeId, date });
      utils.upload.listForStoreDate.invalidate({ store_id: storeId, date });
    },
    onError: (e) => toast.error(e.message),
  });

  if (disabled || isLoading || !data) {
    return null;
  }

  return (
    <Card className="mt-6 border-primary/30">
      <CardContent className="p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-semibold leading-tight">
              Gün Uzlaşması
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              Yüklenen belgeleri Mağaza Özeti ile karşılaştır.
            </div>
          </div>
        </div>

        {/* Checklist */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
          <CheckItem ok={data.has_z} label="Z Raporu" />
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

        {/* Status & verification */}
        <StatusSummary data={data} />

        {/* Approve button (admin only) */}
        {canApprove ? (
          <div className="mt-5 pt-5 border-t flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {data.daily_record_status === "locked"
                ? "Bu gün kilitli."
                : data.status === "match"
                  ? "Tüm kontroller geçti — onaylamaya hazır."
                  : data.status === "mismatch"
                    ? "Fark var. Onay yine de yapılabilir (admin override)."
                    : "Onay için Mağaza Özeti + Z + POS gerekli."}
            </div>
            {data.daily_record_status === "locked" ? null : (
              <Button
                size="sm"
                onClick={() => {
                  if (!data.daily_record_id) return;
                  approve.mutate({ id: data.daily_record_id });
                }}
                disabled={
                  approve.isPending ||
                  !data.has_summary ||
                  !data.daily_record_id
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
            )}
          </div>
        ) : null}
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
  // Opsiyonel kalem: işaret yumuşak (slate), zorunlu değil
  const cls = optional
    ? "bg-slate-50 text-slate-600"
    : ok
      ? "bg-emerald-50 text-emerald-800"
      : "bg-muted/30 text-muted-foreground";
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${cls}`}
    >
      {ok ? (
        <Check className="h-4 w-4 shrink-0" />
      ) : (
        <X className="h-4 w-4 shrink-0" />
      )}
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

function StatusSummary({ data }: { data: ReconData }) {
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
    if (!data.has_z) missing.push("Z Raporu");
    if (data.pos_count === 0) missing.push("POS Fişi");
    const msg =
      missing.length > 0
        ? `Eksik: ${missing.join(", ")}. Bunlar yüklenince mutabakat hesaplanır.`
        : "Mutabakat için zorunlu kalemler tamamlanmalı.";
    return (
      <Banner
        tone="amber"
        icon={<AlertTriangle className="h-4 w-4" />}
        title="Eksik var"
        message={msg}
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
  if (data.status === "ready") {
    return (
      <Banner
        tone="emerald"
        icon={<Check className="h-4 w-4" />}
        title="Doğrulamaya hazır"
        message="Tüm kalemler yüklü. Admin onayı bekliyor."
      />
    );
  }

  const v = data.verification!;
  if (data.status === "match") {
    return (
      <Banner
        tone="emerald"
        icon={<Check className="h-4 w-4" />}
        title="Uzlaşma sağlandı"
        message={`Belge toplamı ${TRY_FMT.format(v.expected_total)} ₺ · Özet toplamı ${TRY_FMT.format(v.actual_total)} ₺ · Fark ${TRY_FMT.format(Math.abs(v.difference))} ₺ (tolerans içinde).`}
      />
    );
  }

  // mismatch
  return (
    <div>
      <Banner
        tone="rose"
        icon={<XCircle className="h-4 w-4" />}
        title="Uzlaşma sağlanmadı"
        message={`Belge ${TRY_FMT.format(v.expected_total)} ₺ vs Özet ${TRY_FMT.format(v.actual_total)} ₺ — Fark ${TRY_FMT.format(Math.abs(v.difference))} ₺.`}
      />
      {v.notes ? (
        <div className="mt-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-800">
          {v.notes}
        </div>
      ) : null}
    </div>
  );
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
