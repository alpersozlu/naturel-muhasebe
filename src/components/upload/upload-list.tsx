"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import {
  FileText,
  Receipt,
  Building,
  Banknote,
  Wallet,
  Trash2,
  ExternalLink,
  AlertCircle,
  Check,
  Calculator,
  ScanLine,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import type {
  UploadType,
  UploadStatus,
  PosSlip,
  StoreSummary,
  BankReceipt,
  Expense,
  ZReport,
} from "@prisma/client";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  PosSlipDetails,
  StoreSummaryDetails,
  BankReceiptDetails,
  ExpenseDetails,
} from "./parsed-details";
import { ZApprovalGate } from "./z-approval-gate";

const TRY_FMT = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "object" && v !== null && "toNumber" in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

const TYPE_META: Record<
  UploadType,
  { label: string; icon: typeof FileText; color: string; bg: string }
> = {
  bank_receipt: {
    label: "İban Dekontu",
    icon: Building,
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  pos_slip: {
    label: "POS Fişi",
    icon: Receipt,
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
  store_summary: {
    label: "Mağaza Özeti",
    icon: FileText,
    color: "text-amber-600",
    bg: "bg-amber-50",
  },
  expense: {
    label: "Masraf/Fatura",
    icon: Wallet,
    color: "text-rose-600",
    bg: "bg-rose-50",
  },
  cash_advance: {
    label: "Faturasız Peşin Ödeme",
    icon: Banknote,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
  z_report: {
    label: "Z Raporu",
    icon: Calculator,
    color: "text-cyan-600",
    bg: "bg-cyan-50",
  },
};

const STATUS_META: Record<
  UploadStatus,
  { label: string; cls: string }
> = {
  pending: {
    label: "Bekliyor",
    cls: "bg-slate-100 text-slate-700 border-slate-200",
  },
  processing: {
    label: "İşleniyor",
    cls: "bg-blue-100 text-blue-700 border-blue-200",
  },
  parsed: {
    label: "İşlendi",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  confirmed: {
    label: "Onaylandı",
    cls: "bg-emerald-100 text-emerald-800 border-emerald-300",
  },
  failed: {
    label: "Başarısız",
    cls: "bg-rose-100 text-rose-700 border-rose-200",
  },
};

type UploadRow = {
  id: string;
  type: UploadType;
  status: UploadStatus;
  file_size_bytes: number;
  uploaded_at: Date;
  uploaded_by_user: { full_name: string | null; email: string };
  date_mismatch?: boolean;
  error_message?: string | null;
  pos_slip?: PosSlip | null;
  store_summary?: StoreSummary | null;
  bank_receipt?: BankReceipt | null;
  expense?: Expense | null;
  z_report?: ZReport | null;
};

export function UploadList({ storeId, date }: { storeId: string; date: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.upload.listForStoreDate.useQuery(
    { store_id: storeId, date },
    {
      enabled: !!storeId && !!date,
      refetchInterval: (query) => {
        const list = query.state.data;
        const hasInflight = list?.some(
          (u) => u.status === "pending" || u.status === "processing"
        );
        return hasInflight ? 3000 : false;
      },
    }
  );

  const del = trpc.upload.delete.useMutation({
    onSuccess: () => {
      toast.success("Silindi");
      utils.upload.listForStoreDate.invalidate({ store_id: storeId, date });
    },
    onError: (e) => toast.error(e.message),
  });

  const confirmMut = trpc.upload.confirm.useMutation({
    onSuccess: () => {
      toast.success("Onaylandı");
      utils.upload.listForStoreDate.invalidate({ store_id: storeId, date });
    },
    onError: (e) => toast.error(e.message),
  });

  const openFile = async (id: string) => {
    try {
      const res = await utils.upload.signedUrl.fetch({ id });
      window.open(res.url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  if (!storeId || !date) return null;

  return (
    <Card className="mt-6">
      <CardContent className="p-0">
        <div className="px-5 py-3 border-b">
          <div className="font-semibold">Bu güne ait yüklemeler</div>
          <div className="text-xs text-muted-foreground">
            {date} — {data?.length ?? 0} dosya
          </div>
        </div>

        {isLoading ? (
          <div className="px-4 py-3 space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <div className="h-14 w-14 rounded-xl animate-pulse bg-muted/60" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 rounded animate-pulse bg-muted/60" />
                  <div className="h-3 w-48 rounded animate-pulse bg-muted/50" />
                </div>
                <div className="h-8 w-32 rounded animate-pulse bg-muted/60" />
              </div>
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Henüz yükleme yok.
          </div>
        ) : (
          <div className="divide-y">
            {data.map((u) => (
              <UploadRowItem
                key={u.id}
                upload={u as unknown as UploadRow}
                onOpen={() => openFile(u.id)}
                onDelete={() => {
                  if (confirm("Bu dosyayı silmek istediğine emin misin?")) {
                    del.mutate({ id: u.id });
                  }
                }}
                onConfirm={() => confirmMut.mutate({ id: u.id })}
                expectedDate={date}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UploadRowItem({
  upload,
  onOpen,
  onDelete,
  onConfirm,
  expectedDate,
}: {
  upload: UploadRow;
  onOpen: () => void;
  onDelete: () => void;
  onConfirm: () => void;
  expectedDate: string;
}) {
  const meta = TYPE_META[upload.type];
  const Icon = meta.icon;
  const status = STATUS_META[upload.status];
  const heroAmount = getHeroAmount(upload);

  return (
    <div className="px-5 py-4 hover:bg-muted/10 transition-colors">
      <div className="flex items-stretch gap-4">
        {/* SOL: Icon + filename + status */}
        <div className="flex items-start gap-3 min-w-0 flex-1 lg:max-w-xs">
          <div
            className={`h-14 w-14 rounded-xl flex items-center justify-center shrink-0 ${meta.bg} ${meta.color}`}
          >
            <Icon className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-foreground">
              {meta.label}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {(upload.file_size_bytes / 1024).toFixed(0)} KB ·{" "}
              {upload.uploaded_by_user.full_name ?? upload.uploaded_by_user.email}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {formatDistanceToNow(upload.uploaded_at, {
                addSuffix: true,
                locale: tr,
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span
                className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full border ${status.cls}`}
              >
                {upload.status === "parsed" || upload.status === "confirmed" ? (
                  <Check className="h-2.5 w-2.5" />
                ) : null}
                {status.label}
              </span>
              {upload.date_mismatch ? (
                <span
                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200"
                  title="Slip tarihi seçtiğin günle uyuşmuyor"
                >
                  <AlertCircle className="h-2.5 w-2.5" />
                  Tarih uyumsuz
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* ORTA: Key fields (dikey ayraçlar) */}
        <div className="hidden lg:flex items-center border-l border-r border-border/60 px-5 flex-1 min-w-0">
          <ParsedFields upload={upload} />
        </div>

        {/* SAĞ: BIG amount + actions */}
        <div className="flex items-center gap-2 shrink-0">
          {heroAmount ? (
            <div className="text-right pr-2">
              <div className="text-2xl lg:text-3xl font-bold tabular-nums tracking-tight text-foreground">
                {TRY_FMT.format(heroAmount.value)}
              </div>
              <div className="text-xs font-medium text-muted-foreground tracking-wider uppercase">
                {heroAmount.unit}
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            {upload.status === "parsed" ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-emerald-700 hover:text-emerald-700 hover:bg-emerald-50"
                title="Onayla"
                onClick={onConfirm}
              >
                <Check className="h-4 w-4" />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Dosyayı aç"
              onClick={onOpen}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              title="Sil"
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* MOBİL: Key fields aşağıda */}
      <div className="lg:hidden mt-3 pt-3 border-t border-border/40">
        <ParsedFields upload={upload} />
      </div>

      {/* Z onay kapı paneli (sadece Z için) */}
      {upload.z_report &&
      (upload.status === "parsed" || upload.status === "confirmed") ? (
        <div className="mt-3 -mx-5 -mb-4">
          <ZApprovalGate
            uploadId={upload.id}
            data={upload.z_report}
            dateMismatch={upload.date_mismatch}
            expectedDate={expectedDate}
          />
        </div>
      ) : null}

      {/* Hata mesajı (failed durumu) */}
      {upload.status === "failed" && upload.error_message ? (
        <div className="mt-3 rounded-lg bg-rose-50/60 border border-rose-200 px-3 py-2 flex items-start gap-2 text-xs text-rose-700">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap leading-relaxed">
            {upload.error_message}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function getHeroAmount(
  upload: UploadRow
): { value: number; unit: string } | null {
  if (upload.status !== "parsed" && upload.status !== "confirmed") return null;
  if (upload.pos_slip) {
    return {
      value: num(upload.pos_slip.net_amount),
      unit: `${upload.pos_slip.currency ?? "TRY"} · Net`,
    };
  }
  if (upload.store_summary) {
    return {
      value: num(upload.store_summary.sales_total),
      unit: `${upload.store_summary.currency ?? "TRY"} · Toplam Satış`,
    };
  }
  if (upload.bank_receipt) {
    return {
      value: num(upload.bank_receipt.amount),
      unit: `${upload.bank_receipt.currency ?? "TRY"} · Dekont`,
    };
  }
  if (upload.expense) {
    return {
      value: num(upload.expense.amount),
      unit: `${upload.expense.currency ?? "TRY"} · Gider`,
    };
  }
  if (upload.z_report) {
    return {
      value: num(upload.z_report.net_sales),
      unit: `${upload.z_report.currency ?? "TRY"} · Z Net`,
    };
  }
  return null;
}

function ParsedFields({ upload }: { upload: UploadRow }) {
  if (upload.pos_slip) {
    const p = upload.pos_slip;
    const dateStr = p.slip_date
      ? new Date(p.slip_date).toLocaleDateString("tr-TR")
      : "—";
    return (
      <div className="grid grid-cols-3 gap-4 w-full">
        <MiniField label="Banka" value={p.bank_name ?? "—"} />
        <MiniField label="Tarih" value={dateStr} />
        <MiniField label="Terminal" value={p.terminal_no ?? "—"} />
      </div>
    );
  }
  if (upload.store_summary) {
    const s = upload.store_summary;
    return (
      <div className="grid grid-cols-3 gap-4 w-full">
        <MiniField label="Nakit" value={`${TRY_FMT.format(num(s.cash_sales))} ₺`} />
        <MiniField
          label="Kredi Kartı"
          value={`${TRY_FMT.format(num(s.credit_card_total))} ₺`}
        />
        <MiniField
          label="Kartuş Puan"
          value={`${TRY_FMT.format(num(s.loyalty_points_total))} ₺`}
        />
      </div>
    );
  }
  if (upload.bank_receipt) {
    const b = upload.bank_receipt;
    const dateStr = b.deposit_date
      ? new Date(b.deposit_date).toLocaleDateString("tr-TR")
      : "—";
    return (
      <div className="grid grid-cols-3 gap-4 w-full">
        <MiniField label="Banka" value={b.bank_name ?? "—"} />
        <MiniField label="Tarih" value={dateStr} />
        <MiniField label="IBAN" value={b.iban ?? "—"} />
      </div>
    );
  }
  if (upload.expense) {
    const e = upload.expense;
    const dateStr = e.expense_date
      ? new Date(e.expense_date).toLocaleDateString("tr-TR")
      : "—";
    return (
      <div className="grid grid-cols-3 gap-4 w-full">
        <MiniField label="Tarih" value={dateStr} />
        <MiniField label="Kategori" value={e.category} />
        <MiniField label="Açıklama" value={e.description ?? "—"} />
      </div>
    );
  }
  if (upload.z_report) {
    const z = upload.z_report;
    const dateStr = z.report_date
      ? new Date(z.report_date).toLocaleDateString("tr-TR")
      : "—";
    return (
      <div className="grid grid-cols-3 gap-4 w-full">
        <MiniField label="Z No" value={z.report_no ?? "—"} />
        <MiniField label="Tarih" value={dateStr} />
        <MiniField
          label="Brüt Satış"
          value={`${TRY_FMT.format(num(z.gross_sales))} ₺`}
        />
      </div>
    );
  }
  // OCR henüz tamamlanmadı — animasyonlu aşama göstergesi
  if (upload.status === "pending" || upload.status === "processing") {
    return <OcrProgressIndicator />;
  }
  return null;
}

// Görsel amaçlı 3-aşama OCR göstergesi.
// Gerçek backend aşaması değil — sadece kullanıcıya "iş yapılıyor" hissi verir.
function OcrProgressIndicator() {
  const stages = [
    { icon: ScanLine, label: "Tanıma" },
    { icon: Sparkles, label: "Çıkarım" },
    { icon: ShieldCheck, label: "Doğrulama" },
  ] as const;
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActive((v) => (v + 1) % stages.length);
    }, 1100);
    return () => clearInterval(id);
  }, [stages.length]);

  return (
    <div className="flex flex-col items-center gap-1.5 py-1">
      <div className="flex items-center gap-1.5">
        {stages.map((s, idx) => {
          const Icon = s.icon;
          const isActive = idx === active;
          const isDone = idx < active;
          return (
            <div key={s.label} className="flex items-center gap-1.5">
              <div
                className={`relative h-7 w-7 rounded-full flex items-center justify-center transition-all duration-500 ${
                  isActive
                    ? "bg-violet-500 text-white shadow-md shadow-violet-500/40 scale-110"
                    : isDone
                      ? "bg-violet-100 text-violet-600"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {isActive && (
                  <span className="absolute inset-0 rounded-full bg-violet-400/30 animate-ping" />
                )}
              </div>
              {idx < stages.length - 1 && (
                <div
                  className={`h-0.5 w-6 rounded-full transition-colors duration-500 ${
                    idx < active ? "bg-violet-400" : "bg-slate-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="text-[11px] font-medium text-violet-600 tabular-nums tracking-wide">
        {stages[active]!.label}…
      </div>
    </div>
  );
}

function MiniField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </div>
      <div className="text-sm font-medium text-foreground truncate mt-0.5">
        {value}
      </div>
    </div>
  );
}

// Eski detail panellerini hâlâ export ediyoruz (başka yerden kullanılabilir).
void PosSlipDetails;
void StoreSummaryDetails;
void BankReceiptDetails;
void ExpenseDetails;
