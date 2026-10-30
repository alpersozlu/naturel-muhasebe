"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  Lock,
  Unlock,
  Loader2,
  AlertTriangle,
  Gauge,
  Receipt,
  CreditCard,
  Landmark,
  Wallet,
  Banknote,
  FileText,
  Database,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { OptimumShareCard } from "@/components/shared/optimum-share-card";
import { fmtShare } from "@/lib/optimum-share";
import { ComparisonPanel, FarkCell } from "./comparison-panel";
import { checkThirdStage, dayOf, docPiecesOf, fmt, num, weekdayOf, type DayRecord, type DocPiece } from "./types";
import { STATUS_META, type DayStatusKey, type DayFlags } from "./status";

export type DayEntry =
  | {
      kind: "filled";
      day: number;
      /** Mutabakatı taşıyan gün (grupta özetli gün). */
      lead: DayRecord;
      /** Grubun tüm günleri (tek günde [lead]). */
      days: DayRecord[];
      status: DayStatusKey;
      flags: DayFlags;
    }
  | { kind: "empty" | "future"; day: number }
  /** Art arda boş geçmiş günler tek satırda (from–to). */
  | { kind: "gap"; day: number; to: number; count: number };

const DOC_ICON: Record<DocPiece["key"], React.ComponentType<{ className?: string }>> = {
  z: Receipt,
  pos: CreditCard,
  iban: Landmark,
  expense: Wallet,
  advance: Banknote,
  summary: FileText,
  sap: Database,
};

/**
 * Doğrulama Sistemi gün satırı. Kapalı hâli tek bakışta: gün, özet satışı,
 * belge rozetleri, kasa farkı, durum. Satırın tamamı açılır (aria-expanded);
 * açılınca sol tarafta döküm, sağda durum kartı + kilit işlemleri.
 */
export function DayRow({
  entry,
  year,
  month,
  isToday,
  onChange,
  canUnlock,
  defaultOpen = false,
}: {
  entry: DayEntry;
  year: number;
  month: number;
  isToday: boolean;
  onChange: () => void;
  canUnlock: boolean;
  /** Satır açık başlasın (önizleme / derin bağlantı). */
  defaultOpen?: boolean;
}) {
  if (entry.kind === "gap") {
    return <GapRow from={entry.day} to={entry.to} count={entry.count} year={year} month={month} />;
  }
  if (entry.kind !== "filled") {
    return <QuietRow day={entry.day} year={year} month={month} kind={entry.kind} isToday={isToday} />;
  }
  return <FilledRow entry={entry} year={year} month={month} isToday={isToday} onChange={onChange} canUnlock={canUnlock} defaultOpen={defaultOpen} />;
}

function QuietRow({ day, year, month, kind, isToday }: { day: number; year: number; month: number; kind: "empty" | "future"; isToday: boolean }) {
  const meta = STATUS_META[kind];
  return (
    <div
      className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border border-dashed px-4 py-2 sm:grid-cols-12 sm:gap-3 ${
        kind === "future" ? "border-border/50 bg-transparent" : "border-border/70 bg-card/40"
      } ${isToday ? "ring-1 ring-primary/30" : ""}`}
    >
      <div className="sm:col-span-1">
        <DayPill day={day} weekday={weekdayOf(year, month, day)} muted isToday={isToday} />
      </div>
      <div className="text-xs italic text-muted-foreground/70 sm:col-span-8">
        {kind === "future" ? "Henüz gelmedi" : isToday ? "Bugün — henüz yükleme yok." : "Bu gün için hiçbir belge yüklenmedi."}
      </div>
      <div className="flex justify-end sm:col-span-3">
        <StatusChip status={kind} compact />
      </div>
      <span className="sr-only">{meta.label}</span>
    </div>
  );
}

/** Art arda boş günler: "1–13 Ekim · 13 gün belge yok" — açılınca gün gün listelenir. */
function GapRow({ from, to, count, year, month }: { from: number; to: number; count: number; year: number; month: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-card/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-3 px-4 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-xs font-semibold tabular-nums text-muted-foreground/70">
          {from}–{to}
        </div>
        <div className="flex-1 text-xs text-muted-foreground/80">
          <span className="font-medium text-muted-foreground">{count} gün</span> belge yok
        </div>
        <StatusChip status="empty" compact />
        <ChevronDown className={`h-4 w-4 text-muted-foreground motion-safe:transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div id={id} className="flex flex-wrap gap-1.5 border-t border-dashed border-border/70 px-4 py-2.5">
          {Array.from({ length: count }, (_, i) => from + i).map((d) => (
            <span key={d} className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1 text-[11px] tabular-nums text-muted-foreground">
              <span className="font-semibold">{d}</span> {weekdayOf(year, month, d)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FilledRow({
  entry,
  year,
  month,
  isToday,
  onChange,
  canUnlock,
  defaultOpen,
}: {
  entry: Extract<DayEntry, { kind: "filled" }>;
  year: number;
  month: number;
  isToday: boolean;
  onChange: () => void;
  canUnlock: boolean;
  defaultOpen: boolean;
}) {
  const { lead: record, days, status, flags } = entry;
  const confirmDialog = useConfirm();
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const isGroup = days.length > 1;
  const isLocked = status === "locked";
  const meta = STATUS_META[status];

  const previewQuery = trpc.verification.preview.useQuery({ daily_record_id: record.id }, { enabled: open });

  const approve = trpc.dailyRecord.approveAndLock.useMutation({
    onSuccess: () => {
      toast.success(isGroup ? "Günler doğrulandı ve kilitlendi" : "Gün doğrulandı ve kilitlendi");
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

  const firstDay = dayOf(days[0]!);
  const lastDay = dayOf(days[days.length - 1]!);
  const summaryDay = days.find((d) => !!d.store_summary);
  const hasSummary = !!summaryDay;
  const summarySales = summaryDay ? num(summaryDay.store_summary!.sales_total_try) : null;
  const thirdStage = hasSummary ? checkThirdStage(record) : { ok: true, reason: null };
  const verification = (isGroup ? (summaryDay ?? record) : record).verification;
  const diff = verification ? num(verification.difference) : null;

  const askUnlock = async () => {
    if (
      await confirmDialog({
        title: isGroup ? "Birleşik günlerin kilidi açılsın mı?" : "Günün kilidi açılsın mı?",
        description: isGroup
          ? `${firstDay}–${lastDay}. günlerin hepsi birlikte açılır; yeniden belge eklenebilir.`
          : "Bu güne yeniden belge eklenebilir ve değiştirilebilir. İşiniz bitince günü yeniden kilitleyin.",
        confirmLabel: "Kilidi aç",
      })
    ) {
      unlock.mutate({ id: record.id });
    }
  };

  const doLock = () => {
    if (!thirdStage.ok) {
      toast.error(thirdStage.reason ?? "3. Aşama kontrolü başarısız");
      return;
    }
    approve.mutate({ id: record.id });
  };

  const rowTone = isLocked
    ? "border-border/70"
    : status === "mismatch"
      ? "border-rose-200"
      : status === "pending"
        ? "border-amber-200"
        : "border-border";

  return (
    <div className={`overflow-hidden rounded-xl border bg-card motion-safe:transition-shadow hover:shadow-sm ${rowTone} ${isGroup ? "border-l-4 border-l-violet-400" : ""} ${isToday ? "ring-1 ring-primary/30" : ""}`}>
      {/* Kapalı satır — tamamı tıklanabilir; klavye için chevron düğmesi aria-expanded taşır. */}
      <div
        className="grid cursor-pointer grid-cols-2 items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-12"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2 sm:col-span-1">
          {isGroup ? <DayPill day={firstDay} to={lastDay} isToday={isToday} /> : <DayPill day={entry.day} weekday={weekdayOf(year, month, entry.day)} isToday={isToday} />}
        </div>

        <div className="text-right sm:col-span-2 sm:text-left">
          {summarySales !== null ? (
            <div>
              <div className="text-sm font-semibold tabular-nums">{fmt(summarySales)} ₺</div>
              <div className="text-[11px] text-muted-foreground">
                {isGroup ? `${days.length} gün birleşik · özet ${dayOf(summaryDay!)}. günde` : "mağaza özeti"}
              </div>
            </div>
          ) : (
            <div className="text-xs italic text-muted-foreground/80">{isGroup ? `${days.length} gün birleşik · özet yok` : "Özet yüklenmedi"}</div>
          )}
        </div>

        <div className="col-span-2 sm:col-span-4">
          {isGroup ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {days.map((d) => (
                <span key={d.id} className="inline-flex items-center gap-1.5 text-xs">
                  <span className="font-semibold tabular-nums text-violet-700">{dayOf(d)}</span>
                  <DocChips pieces={docPiecesOf(d)} />
                </span>
              ))}
            </div>
          ) : (
            <DocChips pieces={docPiecesOf(record)} />
          )}
        </div>

        <div className="text-left sm:col-span-2 sm:text-right">
          {diff !== null && hasSummary ? (
            <div className="text-sm tabular-nums">
              <FarkCell diff={diff} matches={verification!.status !== "mismatch"} />
              <div className="text-[10px] text-muted-foreground">
                {Math.abs(diff) < 0.01 ? "tam" : verification!.status !== "mismatch" ? "tolerans içinde" : diff < 0 ? "eksik" : "fazla"}
                {verification!.status === "manual_override" ? " · yönetici onayı" : ""}
              </div>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground/50">—</span>
          )}
        </div>

        <div className="flex items-center justify-end gap-1.5 sm:col-span-3">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {flags.optimumLow && record.optimum ? (
              <span
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
                title={`Optimum cihazı (Yapı Kredi + Koopbank) ${fmt(record.optimum.optimum)} ₺ ↔ diğer bankalar ${fmt(record.optimum.other)} ₺`}
              >
                <Gauge className="h-3 w-3" aria-hidden />
                Optimum {fmtShare(record.optimum.share)}
              </span>
            ) : null}
            {flags.sapIssue ? (
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800" title={flags.sapIssue}>
                <AlertTriangle className="h-3 w-3" aria-hidden />
                SAP
              </span>
            ) : null}
            <StatusChip status={status} />
          </div>
          <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
            {!isLocked ? (
              <IconButton
                label={hasSummary ? "Doğrula ve kilitle" : "Önce Mağaza Özeti yüklenmeli"}
                disabled={!hasSummary || approve.isPending}
                onClick={doLock}
              >
                {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              </IconButton>
            ) : canUnlock ? (
              <IconButton label="Kilidi aç (yönetici)" disabled={unlock.isPending} onClick={askUnlock}>
                {unlock.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
              </IconButton>
            ) : null}
            <IconButton label={open ? "Dökümü kapat" : "Dökümü aç"} onClick={() => setOpen((o) => !o)} expanded={open} controls={panelId}>
              <ChevronDown className={`h-4 w-4 motion-safe:transition-transform ${open ? "rotate-180" : ""}`} />
            </IconButton>
          </div>
        </div>
      </div>

      {open ? (
        <div id={panelId} className="border-t border-border/70 bg-muted/20 px-4 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              {isGroup ? (
                <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                    Gün gün yüklenenler · mutabakat {days.length} günün toplamıdır
                  </div>
                  <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {days.map((d) => (
                      <div key={d.id} className="flex items-center gap-2 text-sm">
                        <span className="w-8 shrink-0 font-semibold tabular-nums text-violet-800">{dayOf(d)}</span>
                        <DocChips pieces={docPiecesOf(d)} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {record.optimum && record.optimum.status !== "no_pos" ? (
                <div className="mb-3">
                  <OptimumShareCard share={record.optimum} compact />
                </div>
              ) : null}
              {previewQuery.isLoading ? (
                <div className="py-6 text-center text-sm text-muted-foreground" role="status">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden />
                  Mutabakat hesaplanıyor
                </div>
              ) : previewQuery.data ? (
                <ComparisonPanel result={previewQuery.data} />
              ) : null}
            </div>

            <aside className="flex shrink-0 flex-col gap-2 lg:w-64">
              <div className={`rounded-xl border px-4 py-3 ${meta.chip}`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <meta.Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {isGroup && status === "locked" ? "Günler kilitli" : meta.label}
                </div>
                <p className="mt-1 text-xs leading-relaxed opacity-90">{meta.explain}</p>
                {isLocked && verification?.status === "mismatch" && diff !== null ? (
                  <p className="mt-1.5 flex items-start gap-1 text-xs leading-relaxed text-rose-800">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    Kasa farkıyla kilitlenmiş: {diff > 0 ? "+" : ""}{fmt(diff)} ₺.
                  </p>
                ) : null}
              </div>

              {!isLocked && hasSummary ? (
                <>
                  {!thirdStage.ok ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900" role="note">
                      {thirdStage.reason}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={doLock}
                    disabled={approve.isPending || !thirdStage.ok}
                    title={thirdStage.reason ?? undefined}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm motion-safe:transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
                    {isGroup ? "Günleri doğrula ve kilitle" : "Doğrula ve kilitle"}
                  </button>
                </>
              ) : null}
              {!isLocked && !hasSummary ? (
                <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">Kilitlemek için önce mağaza özeti yüklenmeli.</p>
              ) : null}
              {isLocked && canUnlock ? (
                <button
                  type="button"
                  onClick={askUnlock}
                  disabled={unlock.isPending}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold text-foreground motion-safe:transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  {unlock.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Unlock className="h-4 w-4" aria-hidden />}
                  Kilidi aç
                </button>
              ) : null}
            </aside>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  expanded,
  controls,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  expanded?: boolean;
  controls?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-controls={expanded !== undefined ? controls : undefined}
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground motion-safe:transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function StatusChip({ status, compact }: { status: DayStatusKey; compact?: boolean }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium ${m.chip}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {compact ? m.short : m.label}
    </span>
  );
}

function DocChips({ pieces }: { pieces: DocPiece[] }) {
  if (pieces.length === 0) {
    return <span className="text-xs italic text-muted-foreground/60">belge yok</span>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {pieces.map((p) => {
        const Icon = DOC_ICON[p.key];
        return (
          <span
            key={p.key}
            className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-white px-1.5 py-0.5 text-[11px] text-foreground/80"
            title={p.count ? `${p.count} ${p.label}` : p.label}
          >
            <Icon className="h-3 w-3 text-muted-foreground" aria-hidden />
            {p.count ? <span className="tabular-nums font-semibold">{p.count}</span> : null}
            {p.label}
          </span>
        );
      })}
    </span>
  );
}

function DayPill({ day, to, weekday, muted, isToday }: { day: number; to?: number; weekday?: string; muted?: boolean; isToday?: boolean }) {
  const range = to !== undefined && to !== day;
  return (
    <div
      className={`flex h-10 shrink-0 flex-col items-center justify-center rounded-lg leading-none tabular-nums ${
        range ? "w-14 bg-violet-100 text-violet-800" : "w-11"
      } ${muted ? "bg-muted/50 text-muted-foreground/60" : range ? "" : isToday ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}
      title={range ? `${day}–${to} birleşik günler` : isToday ? "Bugün" : undefined}
    >
      <span className={`font-semibold ${range ? "text-xs" : "text-sm"}`}>{range ? `${day}–${to}` : day}</span>
      {!range && weekday ? <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wide opacity-80">{weekday}</span> : null}
    </div>
  );
}
