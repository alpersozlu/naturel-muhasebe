"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, CircleDashed, ClipboardCopy, Clock, Minus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { PeriodView } from "@/server/services/payroll/period";
import { pendingFor, pendingText, type PendingItem, type PendingPerf, type PendingStoreResult } from "@/lib/payroll-pending";

/**
 * BEKLEYEN BELGELER (sahibi, 02.11.2026). Ayın primi için mağaza mağaza
 * neyin geldiği, neyin beklendiği; belge yüklendikçe ya da hedef girildikçe
 * satır kendiliğinden ✓ olur. "Eksikleri kopyala" Mert'e / mağazalara
 * gönderilecek düz metni panoya alır. Hesap: lib/payroll-pending.ts.
 */
export function PendingDocs({ data, onGoExtras }: { data: PeriodView; onGoExtras: () => void }) {
  const perf = trpc.payroll.performance.get.useQuery({ period_id: data.period.id });
  const rows = useMemo(() => {
    const p: PendingPerf[] = (perf.data ?? []).map((x) => ({
      store_id: x.store_id,
      docs: x.docs.map((d) => ({ kind: d.kind, file_name: d.file_name, pages: d.pages })),
      daily: x.check?.daily ?? null,
    }));
    return pendingFor(data.stores, p);
  }, [data.stores, perf.data]);
  if (perf.isLoading) return <div className="text-sm text-muted-foreground">Belgeler okunuyor…</div>;
  return <PendingDocsView periodLabel={data.period.label} rows={rows} onGoExtras={onGoExtras} />;
}

const STATUS_META: Record<PendingItem["status"], { Icon: typeof Check; text: string; cls: string }> = {
  ok: { Icon: Check, text: "geldi", cls: "text-emerald-700" },
  partial: { Icon: CircleDashed, text: "kısmen", cls: "text-amber-700" },
  missing: { Icon: Clock, text: "bekleniyor", cls: "text-rose-700" },
  optional: { Icon: Minus, text: "isteğe bağlı", cls: "text-muted-foreground" },
};

/** Saf görünüm — veri dışarıdan (önizleme ve test için ayrı). */
export function PendingDocsView({ periodLabel, rows, onGoExtras }: { periodLabel: string; rows: PendingStoreResult[]; onGoExtras?: () => void }) {
  const [copied, setCopied] = useState(false);
  const openStores = rows.filter((r) => r.open > 0).length;
  const openItems = rows.reduce((s, r) => s + r.open, 0);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pendingText(periodLabel, rows));
      setCopied(true);
      toast.success("Eksikler panoya kopyalandı");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Panoya kopyalanamadı");
    }
  };

  return (
    <section aria-label="Bekleyen belgeler" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{periodLabel} primi — bekleyen belgeler</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {openItems === 0 ? (
              "Bütün mağazaların belgeleri ve hedefleri tamam."
            ) : (
              <>
                <span className="font-medium text-foreground tabular-nums">{openStores}</span> mağazada{" "}
                <span className="font-medium text-foreground tabular-nums">{openItems}</span> kalem bekleniyor · belgeler &quot;Prim ve mesai girişi&quot;nde mağaza kutusuna bırakılır
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onGoExtras ? (
            <Button variant="outline" size="sm" onClick={onGoExtras}>
              Belge yükle
            </Button>
          ) : null}
          <Button size="sm" onClick={copy} disabled={openItems === 0}>
            {copied ? <Check className="mr-2 h-4 w-4" /> : <ClipboardCopy className="mr-2 h-4 w-4" />}
            Eksikleri kopyala
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <article key={r.store_id} className="rounded-2xl border border-border bg-card shadow-sm">
            <header className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{r.store_name}</div>
                <div className="text-[11px] text-muted-foreground">{r.is_mavi ? "Mavi · SAP belgeleri" : "Derimod · ciro Nebim'den"}</div>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                  r.open === 0 ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"
                )}
              >
                {r.open === 0 ? <Check className="h-3 w-3" aria-hidden /> : <AlertTriangle className="h-3 w-3" aria-hidden />}
                {r.open === 0 ? "tamam" : `${r.open} bekleniyor`}
              </span>
            </header>
            <ul className="divide-y divide-border/60">
              {r.items.map((i) => {
                const m = STATUS_META[i.status];
                return (
                  <li key={i.key} className="flex items-start gap-2.5 px-4 py-2">
                    <m.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", m.cls)} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className={cn(i.status === "optional" && "text-muted-foreground")}>{i.label}</span>
                        <span className={cn("shrink-0 text-[11px] font-medium", m.cls)}>{m.text}</span>
                      </div>
                      {i.detail && i.status !== "optional" ? <div className="mt-0.5 text-xs text-muted-foreground">{i.detail}</div> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
