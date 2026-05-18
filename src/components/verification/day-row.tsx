"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Lock,
  Unlock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const TRY_FORMATTER = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmt(n: number): string {
  return TRY_FORMATTER.format(n);
}

type DayRow = {
  id: string;
  date: Date;
  status: "draft" | "pending" | "approved" | "locked";
  store_summary: { sales_total_try: { toNumber: () => number } | null } | null;
  verification: {
    expected_total: { toNumber: () => number };
    actual_total: { toNumber: () => number };
    difference: { toNumber: () => number };
    status: "match" | "mismatch" | "manual_override";
  } | null;
  _count: {
    pos_slips: number;
    bank_receipts: number;
    expenses: number;
    cash_advances: number;
  };
};

export function DayRow({
  record,
  onChange,
  canUnlock,
}: {
  record: DayRow;
  onChange: () => void;
  canUnlock: boolean;
}) {
  const [open, setOpen] = useState(false);

  const previewQuery = trpc.verification.preview.useQuery(
    { daily_record_id: record.id },
    { enabled: open }
  );

  const approve = trpc.dailyRecord.approveAndLock.useMutation({
    onSuccess: () => {
      toast.success("Gün doğrulandı ve kilitlendi");
      onChange();
    },
    onError: (e) => toast.error(e.message),
  });

  const unlock = trpc.dailyRecord.unlock.useMutation({
    onSuccess: () => {
      toast.success("Kilit açıldı");
      onChange();
    },
    onError: (e) => toast.error(e.message),
  });

  const isLocked = record.status === "locked";
  const verStatus = record.verification?.status;
  const hasSummary = !!record.store_summary;
  const docCount =
    record._count.pos_slips +
    record._count.bank_receipts +
    record._count.expenses +
    record._count.cash_advances +
    (hasSummary ? 1 : 0);

  const badgeMeta = isLocked
    ? { color: "bg-slate-200 text-slate-800", label: "Kilitli" }
    : verStatus === "match"
      ? { color: "bg-emerald-100 text-emerald-700", label: "Eşleşiyor" }
      : verStatus === "mismatch"
        ? { color: "bg-rose-100 text-rose-700", label: "Fark Var" }
        : docCount === 0
          ? { color: "bg-slate-100 text-slate-500", label: "Belge Yok" }
          : { color: "bg-amber-100 text-amber-700", label: "Bekliyor" };

  const dayNum = record.date.getUTCDate();

  return (
    <div className="border rounded-xl bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-4 px-5 py-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm shrink-0">
          {dayNum}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">
            {record.date.toLocaleDateString("tr-TR", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </div>
          <div className="text-xs text-muted-foreground">
            {docCount} belge
            {hasSummary && record.store_summary?.sales_total_try ? (
              <>
                {" · "}Satış {fmt(record.store_summary.sales_total_try.toNumber())} ₺
              </>
            ) : null}
          </div>
        </div>
        <Badge variant="secondary" className={`${badgeMeta.color} text-xs`}>
          {badgeMeta.label}
        </Badge>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open ? (
        <div className="border-t bg-muted/20 px-5 py-4">
          {previewQuery.isLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
              Mutabakat hesaplanıyor
            </div>
          ) : previewQuery.data ? (
            <ComparisonPanel result={previewQuery.data} />
          ) : null}

          <div className="flex items-center gap-2 pt-3 mt-3 border-t justify-end">
            {!isLocked ? (
              <Button
                size="sm"
                disabled={!hasSummary || approve.isPending}
                onClick={() => approve.mutate({ id: record.id })}
                className="bg-slate-900 hover:bg-slate-800"
              >
                <Lock className="h-4 w-4 mr-1.5" />
                Doğrula ve Kilitle
              </Button>
            ) : (
              <>
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">
                  <Check className="h-3 w-3 mr-1" />
                  Gün Doğrulandı
                </Badge>
                {canUnlock ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={unlock.isPending}
                    onClick={() => {
                      if (confirm("Kilidi açmak istediğine emin misin?")) {
                        unlock.mutate({ id: record.id });
                      }
                    }}
                  >
                    <Unlock className="h-4 w-4 mr-1.5" />
                    Kilidi Aç
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ComparisonPanel({
  result,
}: {
  result: {
    rows: Array<{
      label: string;
      document_total: number;
      summary_total: number;
      difference: number;
      matches: boolean;
    }>;
    status: "match" | "mismatch" | "no_data" | "no_summary";
    notes: string | null;
  };
}) {
  if (result.status === "no_summary") {
    return (
      <div className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-3 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        Bu güne ait Mağaza Özeti yüklenmedi — mutabakat yapılamıyor.
      </div>
    );
  }
  if (result.status === "no_data") {
    return (
      <div className="text-sm text-muted-foreground">Bu gün için kayıt yok.</div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-12 gap-2 px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        <div className="col-span-5">Belge Türü</div>
        <div className="col-span-3 text-right">Belge Tutarı</div>
        <div className="col-span-3 text-right">Mağaza Özeti</div>
        <div className="col-span-1 text-right">Durum</div>
      </div>
      {result.rows.map((row, i) => {
        const isLast = i === result.rows.length - 1;
        return (
          <div
            key={row.label}
            className={`grid grid-cols-12 gap-2 px-2 py-2 rounded ${
              isLast ? "bg-card border" : ""
            }`}
          >
            <div
              className={`col-span-5 text-sm ${isLast ? "font-semibold" : ""}`}
            >
              {row.label}
            </div>
            <div className={`col-span-3 text-right text-sm tabular-nums ${isLast ? "font-semibold" : ""}`}>
              {fmt(row.document_total)} ₺
            </div>
            <div className={`col-span-3 text-right text-sm tabular-nums ${isLast ? "font-semibold" : ""}`}>
              {fmt(row.summary_total)} ₺
            </div>
            <div className="col-span-1 text-right">
              {row.matches ? (
                <Check className="h-4 w-4 text-emerald-600 inline" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-rose-600 inline" />
              )}
            </div>
          </div>
        );
      })}
      {result.notes ? (
        <div className="text-xs text-rose-700 bg-rose-50 rounded px-3 py-2 mt-2">
          {result.notes}
        </div>
      ) : null}
    </div>
  );
}
