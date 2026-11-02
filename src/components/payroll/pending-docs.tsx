"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, CheckCircle2, ChevronDown, Circle, CircleDashed, ClipboardCopy, FileUp, Loader2, Minus, Target } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { PeriodView } from "@/server/services/payroll/period";
import { usePerformanceUpload } from "./performance-docs";
import {
  PENDING_GROUP,
  pendingCounts,
  pendingFor,
  pendingText,
  type PendingItem,
  type PendingKey,
  type PendingPerf,
  type PendingStoreResult,
} from "@/lib/payroll-pending";

/**
 * BEKLEYEN BELGELER (sahibi, 02.11.2026). Ayın primi için mağaza mağaza
 * neyin geldiği, neyin beklendiği; belge yüklendikçe ya da hedef girildikçe
 * satır kendiliğinden tamamlanır. Üstte ayın genel ilerlemesi, kartlarda
 * mağazanın ilerleme halkası ve "belgeler / hedefler" grupları; bekleyen
 * kalem açılınca nereden tamamlanacağını söyler. "Eksikleri kopyala"
 * Mert'e / mağazalara gönderilecek düz metni panoya alır (tüm ay ya da tek
 * mağaza). Hesap: lib/payroll-pending.ts. Halka ve açılır satır deseni
 * 21st.dev "Onboarding Checklist"ten uyarlandı.
 *
 * BELGELER YALNIZ BURADAN YÜKLENİR (sahibi, 02.11.2026): Mavi kartına dosya
 * bırakılır ya da "Yükle"ye basılır; okuma bitince çapraz kontrol temizse
 * rakamlar prim tablosuna kendiliğinden işlenir (usePerformanceUpload).
 * "Prim ve mesai girişi"nde yalnız kontrol tablosu ve "Prim tablosuna aktar".
 */
export function PendingDocs({ data, onChanged }: { data: PeriodView; onChanged: () => void }) {
  const utils = trpc.useUtils();
  const perf = trpc.payroll.performance.get.useQuery({ period_id: data.period.id });
  const refresh = () => {
    void utils.payroll.performance.get.invalidate({ period_id: data.period.id });
    onChanged();
  };
  // Kart dışına bırakılan dosya sayfayı terk ettirmesin.
  useEffect(() => {
    const isFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const inZone = (e: DragEvent) => e.target instanceof Element && !!e.target.closest("[data-drop-zone]");
    const over = (e: DragEvent) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer && !inZone(e)) e.dataTransfer.dropEffect = "none";
    };
    const drop = (e: DragEvent) => {
      if (isFiles(e)) e.preventDefault();
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
  const rows = useMemo(() => {
    const p: PendingPerf[] = (perf.data ?? []).map((x) => ({
      store_id: x.store_id,
      docs: x.docs.map((d) => ({ kind: d.kind, file_name: d.file_name, pages: d.pages })),
      daily: x.check?.daily ?? null,
    }));
    return pendingFor(data.stores, p);
  }, [data.stores, perf.data]);
  if (perf.isLoading) return <div className="text-sm text-muted-foreground">Belgeler okunuyor…</div>;
  return <PendingDocsView periodLabel={data.period.label} rows={rows} upload={{ periodId: data.period.id, closed: data.period.status === "closed", onChanged: refresh }} />;
}

// ───────────────── Durum dili ─────────────────
const STATUS: Record<PendingItem["status"], { label: string; Icon: typeof Check; icon: string; chip: string }> = {
  ok: { label: "geldi", Icon: CheckCircle2, icon: "text-emerald-600", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  partial: { label: "kısmen", Icon: CircleDashed, icon: "text-amber-600", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  missing: { label: "bekleniyor", Icon: Circle, icon: "text-rose-500", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
  optional: { label: "isteğe bağlı", Icon: Minus, icon: "text-muted-foreground/60", chip: "bg-muted text-muted-foreground ring-border" },
};

/** Bekleyen kalem açılınca: nereden tamamlanır. */
const HOW: Record<PendingKey, string> = {
  bi_sales: "SAP BI › Çalışan Performans Raporu — satış sayfası (Net TL, UPT, tekli). PDF'i ya da \"Çalışan Satış KPI\" tablosunun Excel'ini bu karta bırakın; kategori sayfasıyla birleşir.",
  bi_category: "Aynı raporun kategori sayfası (adetler). Ayrı PDF olarak gelebilir; ikincisi birincinin üstüne yazmaz, tamamlar.",
  kpi: "IT POS › Personel KPI Raporu (Excel) — bu karta bırakın. Denimin TL tutarı yalnız burada var; BI'ın kategori sayfası yalnız adet verir, KPI'nın yerini tutmaz.",
  itpos: "IT POS'tan ay için (1–31) alınan Performans Excel'i: mağazanın kuruşlu Net Ciro'su, UPT, sepet, tekli ve 2+1'li fatura oranı (örnek: Girne \"It pos 01 31 ekim 2026 performans.xlsx\"). Zorunlu — bu karta bırakın; yüklenmeden rakamlar prim tablosuna aktarılmaz.",
  daily: "Eksik günleri içeren bayi gün sonu Excel'i bu karta bırakılır (birkaç günü birden içerebilir); kişi cirosu bunlarla karşılaştırılır.",
  nebim: "Genel bakışta \"Derimod cirolarını Nebim'den al\" düğmesi; mağaza ve kişi cirosu Derimod Satışları'ndan gelir.",
  store_target: "Genel bakışta mağaza kartındaki \"Merkez hedefi (aylık)\" alanı; müdür ve müdür yardımcısının primi buna bağlı.",
  person_targets: "Prim ve mesai girişi'nde kişinin \"Hedef\" hücresi (ya da satırı açıp \"Kişisel hedef\"); satış asistanının primi buna bağlı.",
};

// ───────────────── İlerleme halkası ─────────────────
function Ring({ done, total, size = 44, stroke = 4 }: { done: number; total: number; size?: number; stroke?: number }) {
  const pct = total > 0 ? (done / total) * 100 : 100;
  const r = (size - stroke) / 2;
  const tone = pct >= 100 ? "stroke-emerald-500" : pct >= 50 ? "stroke-amber-500" : "stroke-rose-500";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        pathLength={100}
        strokeDasharray={100}
        strokeLinecap="round"
        className={cn(tone, "motion-safe:transition-[stroke-dashoffset] motion-safe:duration-500")}
        style={{ strokeDashoffset: 100 - pct }}
      />
    </svg>
  );
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} panoya kopyalandı`);
    return true;
  } catch {
    toast.error("Panoya kopyalanamadı");
    return false;
  }
}

// ───────────────── Görünüm ─────────────────
/** Saf görünüm — veri dışarıdan (önizleme ve test için ayrı). */
type UploadCfg = { periodId: string; closed: boolean; onChanged: () => void };

export function PendingDocsView({ periodLabel, rows, upload }: { periodLabel: string; rows: PendingStoreResult[]; upload?: UploadCfg }) {
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const c = pendingCounts(rows);
  const pct = c.total > 0 ? Math.round((c.ok / c.total) * 100) : 100;
  const openStores = rows.filter((r) => r.open > 0).length;
  // Bekleyeni çok olan önde; tamamlananlar sona.
  const ordered = [...rows].sort((a, b) => (a.open === 0 ? 1 : 0) - (b.open === 0 ? 1 : 0) || b.open - a.open);
  const shown = onlyOpen ? ordered.filter((r) => r.open > 0) : ordered;

  return (
    <section aria-label="Bekleyen belgeler" className="space-y-4">
      {/* Ayın özeti */}
      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Ring done={c.ok} total={c.total} size={64} stroke={6} />
              <span className="absolute inset-0 grid place-content-center text-sm font-semibold tabular-nums">%{pct}</span>
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{periodLabel} primi</div>
              <div className="text-lg font-semibold tracking-tight">
                {c.ok} / {c.total} kalem tamam
              </div>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {openStores === 0 ? "Bütün mağazaların belgeleri ve hedefleri tamam." : `${openStores} mağazada eksik var · SAP belgelerini ilgili Mavi kartına sürükleyip bırakın`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={openStores === 0}
              onClick={async () => {
                if (await copyText(pendingText(periodLabel, rows), "Eksikler")) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }
              }}
            >
              {copied ? <Check className="mr-2 h-4 w-4" /> : <ClipboardCopy className="mr-2 h-4 w-4" />}
              Eksikleri kopyala
            </Button>
          </div>
        </div>

        {/* Dağılım + süzgeç */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-2.5 sm:px-5">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Kalem dağılımı">
            {(["ok", "partial", "missing"] as const).map((k) => {
              const m = STATUS[k];
              return (
                <li key={k} className="flex items-center gap-1.5 text-muted-foreground">
                  <m.Icon className={cn("h-3.5 w-3.5", m.icon)} aria-hidden />
                  <span className="font-semibold tabular-nums text-foreground">{c[k]}</span> {m.label}
                </li>
              );
            })}
          </ul>
          <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs" role="radiogroup" aria-label="Göster">
            {[
              [false, "Tüm mağazalar"],
              [true, "Yalnız eksikler"],
            ].map(([v, label]) => (
              <button
                key={String(v)}
                type="button"
                role="radio"
                aria-checked={onlyOpen === v}
                onClick={() => setOnlyOpen(v as boolean)}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  onlyOpen === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label as string}
              </button>
            ))}
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">Eksik kalan mağaza yok.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((r) =>
            upload && r.is_mavi ? (
              <UploadableStoreCard key={r.store_id} row={r} periodLabel={periodLabel} cfg={upload} />
            ) : (
              <StoreCard key={r.store_id} row={r} periodLabel={periodLabel} />
            )
          )}
        </div>
      )}
    </section>
  );
}

/** Mavi kartı: dosya bırakılır / seçilir → okunur → temizse prim tablosuna işlenir. */
function UploadableStoreCard({ row, periodLabel, cfg }: { row: PendingStoreResult; periodLabel: string; cfg: UploadCfg }) {
  const { onFiles, busy } = usePerformanceUpload({
    periodId: cfg.periodId,
    storeId: row.store_id,
    closed: cfg.closed,
    onChanged: cfg.onChanged,
    onApplied: cfg.onChanged,
  });
  return <StoreCard row={row} periodLabel={periodLabel} uploader={{ onFiles, busy, closed: cfg.closed }} />;
}

type Uploader = { onFiles: (files: File[] | FileList | null) => Promise<void>; busy: boolean; closed: boolean };

function StoreCard({ row, periodLabel, uploader }: { row: PendingStoreResult; periodLabel: string; uploader?: Uploader }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const droppable = !!uploader && !uploader.closed;
  const carriesFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const pick = async (files: File[] | FileList | null) => {
    if (!uploader) return;
    await uploader.onFiles(files);
    if (input.current) input.current.value = "";
  };
  const counted = row.items.filter((i) => i.status !== "optional");
  const done = counted.filter((i) => i.status === "ok").length;
  const firstOpen = row.items.find((i) => i.status === "missing" || i.status === "partial")?.key ?? null;
  const [openKey, setOpenKey] = useState<PendingKey | null>(firstOpen);
  const groups = [
    { id: "docs" as const, title: row.is_mavi ? "Belgeler" : "Ciro", Icon: FileUp },
    { id: "targets" as const, title: "Hedefler", Icon: Target },
  ];

  return (
    <article
      data-drop-zone={droppable ? "" : undefined}
      className={cn(
        "relative flex flex-col rounded-2xl border bg-card shadow-sm",
        row.open === 0 ? "border-emerald-200" : "border-border",
        dragDepth > 0 && droppable && "border-sky-400 ring-2 ring-sky-300"
      )}
      onDragEnter={(e) => {
        if (!uploader || !carriesFiles(e)) return;
        e.preventDefault();
        setDragDepth((d) => d + 1);
      }}
      onDragOver={(e) => {
        if (!uploader || !carriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = droppable ? "copy" : "none";
      }}
      onDragLeave={(e) => {
        if (uploader && carriesFiles(e)) setDragDepth((d) => Math.max(0, d - 1));
      }}
      onDrop={(e) => {
        if (!uploader || !carriesFiles(e)) return;
        e.preventDefault();
        setDragDepth(0);
        if (droppable) void pick(Array.from(e.dataTransfer.files));
      }}
    >
      {dragDepth > 0 ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-2xl text-center text-sm font-medium backdrop-blur-[1px]",
            droppable ? "bg-sky-50/90 text-sky-900" : "bg-muted/85 text-muted-foreground"
          )}
        >
          {droppable ? (
            <>
              <FileUp className="h-5 w-5" aria-hidden />
              Bırakın — {row.store_name}
              <span className="text-xs font-normal">okunur, tutuyorsa prim tablosuna işlenir</span>
            </>
          ) : (
            "Ay kapalı — belge yüklenemez"
          )}
        </div>
      ) : null}
      <header className="flex items-center gap-3 px-4 pb-3 pt-4">
        <div className="relative">
          <Ring done={done} total={counted.length} />
          <span className="absolute inset-0 grid place-content-center text-[11px] font-semibold tabular-nums">
            {done}/{counted.length}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{row.store_name}</div>
          <div className="text-[11px] text-muted-foreground">{row.is_mavi ? "Mavi · SAP belgeleri" : "Derimod · ciro Nebim'den"}</div>
        </div>
        {uploader ? (
          <>
            <input ref={input} type="file" multiple accept=".xlsx,.pdf" className="hidden" onChange={(e) => void pick(e.target.files)} />
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs"
              onClick={() => input.current?.click()}
              disabled={uploader.busy || uploader.closed}
              aria-label={`${row.store_name} belge yükle`}
            >
              {uploader.busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileUp className="mr-1.5 h-3.5 w-3.5" />}
              {uploader.busy ? "Okunuyor…" : "Yükle"}
            </Button>
          </>
        ) : null}
        {row.open > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-muted-foreground"
            onClick={() => void copyText(pendingText(periodLabel, [row]), `${row.store_name} eksikleri`)}
            aria-label={`${row.store_name} eksiklerini kopyala`}
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
            <Check className="h-3 w-3" aria-hidden /> tamam
          </span>
        )}
      </header>

      <div className="flex-1 space-y-3 px-2 pb-3">
        {groups.map((g) => {
          const items = row.items.filter((i) => PENDING_GROUP[i.key] === g.id);
          if (items.length === 0) return null;
          return (
            <div key={g.id}>
              <div className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <g.Icon className="h-3 w-3" aria-hidden /> {g.title}
              </div>
              <ul className="space-y-0.5">
                {items.map((i) => (
                  <ItemRow key={i.key} item={i} open={openKey === i.key} onToggle={() => setOpenKey(openKey === i.key ? null : i.key)} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function ItemRow({ item, open, onToggle }: { item: PendingItem; open: boolean; onToggle: () => void }) {
  const m = STATUS[item.status];
  const actionable = item.status === "missing" || item.status === "partial";
  return (
    <li className={cn("rounded-xl transition-colors", open && actionable && "bg-muted/60 ring-1 ring-border")}>
      <button
        type="button"
        onClick={onToggle}
        disabled={!actionable}
        aria-expanded={actionable ? open : undefined}
        className="flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <m.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", m.icon)} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn("text-sm", item.status === "optional" ? "text-muted-foreground" : item.status === "ok" ? "text-foreground/80" : "font-medium")}>
              {item.label}
            </span>
            <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ring-1", m.chip)}>{m.label}</span>
          </span>
          {item.detail && item.status !== "optional" ? <span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span> : null}
          {open && actionable ? <span className="mt-1.5 block text-xs leading-relaxed text-foreground/80">{HOW[item.key]}</span> : null}
        </span>
        {actionable ? (
          <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground motion-safe:transition-transform", open && "rotate-180")} aria-hidden />
        ) : (
          <span className="w-4 shrink-0" />
        )}
      </button>
    </li>
  );
}
