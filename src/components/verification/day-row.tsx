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

// Prisma Decimal tRPC üzerinden string'e serialize edilir — client'ta
// .toNumber() artık çağrılamaz. Bu helper hem Decimal object hem string/number'ı destekler.
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "object" && v !== null && "toNumber" in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

function fmt(n: number): string {
  return TRY_FORMATTER.format(n);
}

type DayRecord = {
  id: string;
  date: Date;
  status: "draft" | "pending" | "approved" | "locked";
  store_summary: { sales_total_try: unknown } | null;
  verification: {
    expected_total: unknown;
    actual_total: unknown;
    difference: unknown;
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
              {fmt(num(record.store_summary.sales_total_try))} ₺
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
          <div className="flex flex-col lg:flex-row gap-4 items-stretch">
            {/* Sol: karşılaştırma tablosu */}
            <div className="flex-1 min-w-0">
              {previewQuery.isLoading ? (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Mutabakat hesaplanıyor
                </div>
              ) : previewQuery.data ? (
                <ComparisonPanel result={previewQuery.data} />
              ) : null}
            </div>

            {/* Sağ: status pill + ana aksiyon */}
            <div className="flex flex-col gap-2 lg:w-60 shrink-0 lg:self-start">
              <DayStatusPill
                isLocked={isLocked}
                verStatus={verStatus}
                hasSummary={hasSummary}
                docCount={docCount}
              />
              {!isLocked && hasSummary ? (
                <button
                  type="button"
                  onClick={() => approve.mutate({ id: record.id })}
                  disabled={approve.isPending}
                  className="flex items-center justify-center gap-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-5 py-4 transition-colors shadow-sm"
                >
                  {approve.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                  <span>Doğrula ve Kilitle</span>
                </button>
              ) : isLocked && canUnlock ? (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Kilidi açmak istediğine emin misin?")) {
                      unlock.mutate({ id: record.id });
                    }
                  }}
                  disabled={unlock.isPending}
                  className="flex items-center justify-center gap-2.5 rounded-2xl bg-white hover:bg-muted/40 border border-border disabled:opacity-50 text-foreground font-semibold px-5 py-4 transition-colors"
                >
                  {unlock.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Unlock className="h-4 w-4" />
                  )}
                  <span>Kilidi Aç</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Doğrulama sayfasındaki büyük status pill — duruma göre renk değişir */
function DayStatusPill({
  isLocked,
  verStatus,
  hasSummary,
  docCount,
}: {
  isLocked: boolean;
  verStatus: "match" | "mismatch" | "manual_override" | undefined;
  hasSummary: boolean;
  docCount: number;
}) {
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
  if (verStatus === "match") {
    return (
      <div className="rounded-2xl bg-amber-500 text-white px-5 py-4 flex items-center gap-2.5 shadow-sm">
        <Check className="h-4 w-4 shrink-0" />
        <span className="font-semibold text-sm leading-tight">
          Gün Mutabakatı Sağlandı
        </span>
      </div>
    );
  }
  if (verStatus === "mismatch") {
    return (
      <div className="rounded-2xl bg-rose-500 text-white px-5 py-4 flex items-center gap-2.5 shadow-sm">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="font-semibold text-sm leading-tight">
          Mutabakat Sağlanmadı
        </span>
      </div>
    );
  }
  if (!hasSummary) {
    return (
      <div className="rounded-2xl bg-amber-100 text-amber-800 border border-amber-200 px-5 py-4 flex items-center gap-2.5">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span className="font-semibold text-sm leading-tight">
          Mağaza Özeti Eksik
        </span>
      </div>
    );
  }
  if (docCount === 0) {
    return (
      <div className="rounded-2xl bg-slate-100 text-slate-700 border border-slate-200 px-5 py-4 flex items-center gap-2.5">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span className="font-semibold text-sm leading-tight">
          Belge Yok
        </span>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-slate-100 text-slate-700 border border-slate-200 px-5 py-4 flex items-center gap-2.5">
      <Loader2 className="h-4 w-4 shrink-0" />
      <span className="font-semibold text-sm leading-tight">
        Beklemede
      </span>
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
      <div className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-3 flex items-start gap-2 border border-amber-200/60">
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

  // Açıklama notlarını parçala (cümle bazlı) — her biri ayrı pill
  const noteList = result.notes
    ? result.notes
        .split(/(?<=\.)\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return (
    <div>
      {/* Tablo */}
      <div className="rounded-xl border border-border/70 overflow-hidden bg-card">
        <div className="grid grid-cols-12 gap-2 px-5 py-2.5 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          <div className="col-span-4">Belge Türü</div>
          <div className="col-span-3 text-right">Belge Tutarı</div>
          <div className="col-span-2 text-right">Mağaza Özeti</div>
          <div className="col-span-2 text-right">Fark</div>
          <div className="col-span-1 text-right">Durum</div>
        </div>
        <div>
          {result.rows.map((row, i) => {
            const isLast = i === result.rows.length - 1;
            return (
              <div
                key={row.label}
                className={`grid grid-cols-12 gap-2 px-5 py-3 items-baseline ${
                  isLast
                    ? "border-t-2 border-border bg-slate-50/40 font-semibold"
                    : i === 0
                      ? ""
                      : "border-t border-border/40"
                }`}
              >
                <div className="col-span-4 text-sm text-foreground">
                  {row.label}
                </div>
                <div className="col-span-3 text-right text-sm tabular-nums text-foreground">
                  {fmt(row.document_total)} ₺
                </div>
                <div className="col-span-2 text-right text-sm tabular-nums text-muted-foreground">
                  {fmt(row.summary_total)} ₺
                </div>
                <div className="col-span-2 text-right text-sm tabular-nums">
                  <FarkCell diff={row.difference} matches={row.matches} />
                </div>
                <div className="col-span-1 text-right">
                  {row.matches ? (
                    <Check
                      className="h-4 w-4 text-emerald-600 inline"
                      aria-label="Eşleşti"
                    />
                  ) : (
                    <AlertTriangle
                      className="h-4 w-4 text-rose-600 inline"
                      aria-label="Eşleşmiyor"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Açıklama notları — varsa */}
      {noteList.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {noteList.map((note, i) => (
            <NoteCard key={i} text={note} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FarkCell({ diff, matches }: { diff: number; matches: boolean }) {
  // Konvansiyon: docs − summary
  //   pozitif → elimizdeki belge özetten fazla (fazla)
  //   negatif → belge özetten az (eksik)
  //   |diff| ≤ tolerans (matches=true) → 0,00 (yeşil, eşleşti)
  if (Math.abs(diff) < 0.01) {
    return <span className="text-emerald-600">0,00 ₺</span>;
  }
  if (matches) {
    // Tolerans içinde ama sıfır değil — yeşil ama "minor"
    const positive = diff > 0;
    return (
      <span className="text-emerald-600 font-medium">
        {positive ? "+" : ""}
        {fmt(diff)} ₺
      </span>
    );
  }
  // Tolerans dışı: pozitif = fazla (amber), negatif = eksik (rose)
  const positive = diff > 0;
  const tone = positive ? "text-amber-700" : "text-rose-700";
  return (
    <span className={`${tone} font-medium`}>
      {positive ? "+" : ""}
      {fmt(diff)} ₺
    </span>
  );
}

function NoteCard({ text }: { text: string }) {
  // İlk iki kelimeyi başlık olarak gösterelim ("Kasa eksiklik:", "Kasa fazlalık:")
  const colonIdx = text.indexOf(":");
  const label = colonIdx > 0 ? text.slice(0, colonIdx) : null;
  const body = colonIdx > 0 ? text.slice(colonIdx + 1).trim() : text;

  // Eksik = kırmızı; Fazla = amber; diğer = rose (default)
  const isDeficit = /eksik/i.test(label ?? "");
  const tone = isDeficit
    ? "bg-rose-50 border-rose-200 text-rose-800"
    : "bg-amber-50 border-amber-200 text-amber-800";

  return (
    <div
      className={`text-sm rounded-lg border px-4 py-2.5 flex items-start gap-2.5 ${tone}`}
    >
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 opacity-80" />
      <div className="leading-relaxed">
        {label ? <span className="font-semibold">{label}:</span> : null}{" "}
        <span>{body}</span>
      </div>
    </div>
  );
}
