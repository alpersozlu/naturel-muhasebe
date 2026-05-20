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
  AlertCircle,
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

type DayRecord = {
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

type Props =
  | {
      record: DayRecord;
      onChange: () => void;
      canUnlock: boolean;
      emptyDay?: undefined;
    }
  | {
      emptyDay: { day: number; year: number; month: number };
      record?: undefined;
      onChange?: undefined;
      canUnlock?: undefined;
    };

export function DayRow(props: Props) {
  if (props.emptyDay) {
    return <EmptyDayRow {...props.emptyDay} />;
  }
  return (
    <FilledDayRow
      record={props.record}
      onChange={props.onChange}
      canUnlock={props.canUnlock}
    />
  );
}

function EmptyDayRow({ day }: { day: number; year: number; month: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center border rounded-xl bg-card/40 px-5 py-3.5">
      <div className="sm:col-span-1">
        <DayPill day={day} muted />
      </div>
      <div className="sm:col-span-3 text-sm text-muted-foreground/70 italic">
        Yüklenmedi
      </div>
      <div className="sm:col-span-5 text-sm text-muted-foreground/60 italic flex items-center gap-2">
        <AlertCircle className="h-3.5 w-3.5" />
        Bu gün için hiçbir belge yüklenmedi.
      </div>
      <div className="sm:col-span-3 flex justify-end">
        <Badge variant="secondary" className="bg-slate-100 text-slate-500">
          Boş
        </Badge>
      </div>
    </div>
  );
}

function FilledDayRow({
  record,
  onChange,
  canUnlock,
}: {
  record: DayRecord;
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
    ? { color: "bg-emerald-100 text-emerald-700", label: "Doğrulandı" }
    : verStatus === "match"
      ? { color: "bg-emerald-100 text-emerald-700", label: "Eşleşiyor" }
      : verStatus === "mismatch"
        ? { color: "bg-rose-100 text-rose-700", label: "Fark Var" }
        : docCount === 0
          ? { color: "bg-slate-100 text-slate-500", label: "Belge Yok" }
          : { color: "bg-amber-100 text-amber-700", label: "Beklemede" };

  const dayNum = new Date(record.date).getUTCDate();

  // Belge sayısı parçalı özet
  const docPieces: string[] = [];
  if (record._count.pos_slips > 0) docPieces.push(`${record._count.pos_slips} POS`);
  if (record._count.bank_receipts > 0)
    docPieces.push(`${record._count.bank_receipts} İban`);
  if (record._count.expenses > 0)
    docPieces.push(`${record._count.expenses} Masraf`);
  if (record._count.cash_advances > 0)
    docPieces.push(`${record._count.cash_advances} Peşin`);
  if (hasSummary) docPieces.push("1 Mağaza Özeti");

  return (
    <div className="border rounded-xl bg-card overflow-hidden hover:shadow-sm transition-shadow">
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center px-5 py-3.5">
        <div className="sm:col-span-1">
          <DayPill day={dayNum} />
        </div>

        <div className="sm:col-span-3">
          {hasSummary && record.store_summary?.sales_total_try ? (
            <div className="text-sm font-semibold tabular-nums text-emerald-700">
              {fmt(record.store_summary.sales_total_try.toNumber())} ₺
            </div>
          ) : (
            <div className="text-sm text-muted-foreground/70 italic">
              Özet yüklenmedi
            </div>
          )}
        </div>

        <div className="sm:col-span-5">
          {docPieces.length === 0 ? (
            <div className="text-sm text-muted-foreground/60 italic flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5" />
              Bu gün için hiçbir belge yüklenmedi.
            </div>
          ) : (
            <div className="text-sm text-foreground/80">
              {docPieces.join(" · ")}
            </div>
          )}
        </div>

        <div className="sm:col-span-3 flex items-center justify-end gap-2">
          <Badge variant="secondary" className={`${badgeMeta.color} text-xs`}>
            {badgeMeta.label}
          </Badge>
          {!isLocked ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!hasSummary || approve.isPending}
              onClick={() => approve.mutate({ id: record.id })}
              title={
                hasSummary
                  ? "Bu günü doğrula ve kilitle"
                  : "Önce Mağaza Özeti yüklenmeli"
              }
            >
              {approve.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Lock className="h-3.5 w-3.5" />
              )}
            </Button>
          ) : canUnlock ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={unlock.isPending}
              onClick={() => {
                if (confirm("Kilidi açmak istediğine emin misin?")) {
                  unlock.mutate({ id: record.id });
                }
              }}
              title="Kilidi aç (admin)"
            >
              <Unlock className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setOpen((o) => !o)}
            title={open ? "Detayı gizle" : "Detayı göster"}
          >
            {open ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

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

          {isLocked ? (
            <div className="pt-3 mt-3 border-t flex justify-end">
              <Badge
                variant="secondary"
                className="bg-emerald-100 text-emerald-700"
              >
                <Check className="h-3 w-3 mr-1" />
                Gün Doğrulandı ve Kilitli
              </Badge>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DayPill({ day, muted }: { day: number; muted?: boolean }) {
  return (
    <div
      className={`flex h-10 w-10 items-center justify-center rounded-xl font-semibold text-sm tabular-nums ${
        muted
          ? "bg-muted/50 text-muted-foreground/60"
          : "bg-primary/10 text-primary"
      }`}
    >
      {day}
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
            <div
              className={`col-span-3 text-right text-sm tabular-nums ${
                isLast ? "font-semibold" : ""
              }`}
            >
              {fmt(row.document_total)} ₺
            </div>
            <div
              className={`col-span-3 text-right text-sm tabular-nums ${
                isLast ? "font-semibold" : ""
              }`}
            >
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
