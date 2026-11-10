"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, ListPlus, Target, UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { ComputedLine, PeriodView, StoreBlock } from "@/server/services/payroll/period";
import { CARRY_FORWARD_CATEGORY, isOvertimeOnlyPosition } from "@/server/services/payroll/rules";
import type { KolayikMonth } from "@/server/services/kolayik/payroll-sync";
import { pendingFor, type PendingPerf } from "@/lib/payroll-pending";
import type { BatchChoice } from "../batch-dialog";
import { hoursTr, money, pct } from "../format";
import { overtimeApplyDecision } from "../overtime-apply";
import { IkPanel } from "../ik-panel";
import { KolayikPanel } from "../kolayik-panel";
import { NewStarterDialog } from "../new-starter-dialog";
import { PendingDocs } from "../pending-docs";
import { PerformanceDocs } from "../performance-docs";
import { SundayAuditPanel } from "../sunday-audit";
import { BatchList } from "./batch-list";
import { BulkEntryDialog } from "./bulk-entry-dialog";
import { Chip, Dash, Disclosure, otherPremiums, ROW, StepHeader, StoreShell, TD, TH } from "./parts";
import { StoreTargetsDialog } from "./store-targets-dialog";

type Overtime = KolayikMonth["overtime"][number];

/**
 * 3. ADIM — PRİM (ÖDEME 2). Mesai + satış primi + diğer primler + eklemeler −
 * kesintiler; nakit, mağaza mağaza ödenir.
 *
 * Tablo yalnız OKUNUR: satıra tıklayınca kişinin paneli açılır, bütün giriş
 * oradadır. Bir mağazanın ciro ve hedefleri tek pencereden ("Ciro ve
 * hedefler"), aynı sebepli kesintiler tek pencereden ("Toplu kesinti /
 * ekleme") girilir. Belge yükleme ve çapraz kontrol ikinci görünümdedir.
 */
export function StepExtras({
  data,
  closed,
  kolay,
  onOpenLine,
  onBatch,
  onChanged,
  initialView = "people",
}: {
  data: PeriodView;
  closed: boolean;
  /** Açılış görünümü — varsayılan kişi tablosu */
  initialView?: "people" | "docs";
  kolay: { data: KolayikMonth | undefined; loading: boolean; error: string | null; refetch: () => void };
  onOpenLine: (id: string) => void;
  onBatch: (c: BatchChoice) => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [view, setView] = useState<"people" | "docs">(initialView);
  const [targets, setTargets] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const [starter, setStarter] = useState(false);
  const perf = trpc.payroll.performance.get.useQuery({ period_id: data.period.id });
  const update = trpc.payroll.lines.update.useMutation();

  const pending = useMemo(() => {
    const p: PendingPerf[] = (perf.data ?? []).map((x) => ({
      store_id: x.store_id,
      docs: x.docs.map((d) => ({ kind: d.kind, file_name: d.file_name, pages: d.pages })),
      daily: x.check?.daily ?? null,
    }));
    return new Map(pendingFor(data.stores, p).map((r) => [r.store_id, r.open]));
  }, [data.stores, perf.data]);
  const pendingTotal = Array.from(pending.values()).reduce((s, n) => s + n, 0);

  const otByLine = useMemo(() => new Map((kolay.data?.overtime ?? []).filter((o) => o.line_id).map((o) => [o.line_id!, o])), [kolay.data]);
  const allLines = data.stores.flatMap((s) => s.lines);
  // Kolay İK'da onaylı saati bordrodakinden farklı olanlar (bekleyen kayıtla açıklananlar hariç).
  const otDiffs = allLines
    .filter((l) => !l.paid_by_day && l.employee_status !== "inactive")
    .map((l) => ({ l, ot: otByLine.get(l.id) }))
    .filter((x): x is { l: ComputedLine; ot: Overtime } => !!x.ot)
    .map((x) => ({ ...x, d: overtimeApplyDecision(x.ot, x.l.overtime_hours) }))
    .filter((x) => x.d.mode === "apply" && (x.ot.approved_hours > 0 || x.l.overtime_hours > 0));

  const [applying, setApplying] = useState(false);
  const applyAll = async () => {
    const ok = await confirm({
      title: `${otDiffs.length} kişinin mesaisi Kolay İK’daki onaylı saate çekilsin mi?`,
      description: otDiffs.map((x) => `${x.l.full_name}: ${hoursTr(x.l.overtime_hours)} → ${hoursTr(x.ot.approved_hours)} saat`).join("\n"),
      confirmLabel: "Uygula",
    });
    if (!ok) return;
    setApplying(true);
    try {
      for (const x of otDiffs) await update.mutateAsync({ id: x.l.id, overtime_hours: x.ot.approved_hours, overtime_note: x.ot.note });
      toast.success(`${otDiffs.length} kişinin mesaisi güncellendi`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Güncellenemedi");
    } finally {
      setApplying(false);
      onChanged();
    }
  };

  const t = data.totals;
  const targetStore = targets ? data.stores.find((s) => s.store_id === targets) : null;

  return (
    <div className="space-y-5">
      <StepHeader title="Prim — Ödeme 2" description="Mesai, satış primi ve diğer primler; eklemeler eklenir, kesintiler düşülür. Nakit ödenir, mağaza mağaza kaydedilir.">
        <Button variant="outline" onClick={() => setBulk(true)} disabled={closed}>
          <ListPlus className="mr-2 h-4 w-4" />
          Toplu kesinti / ekleme
        </Button>
        <Button variant="outline" onClick={() => setStarter(true)} disabled={closed}>
          <UserPlus className="mr-2 h-4 w-4" />
          Yeni başlayan
        </Button>
      </StepHeader>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border bg-card px-5 py-3 shadow-xs">
        <div className="inline-flex rounded-lg border p-0.5 text-sm" role="tablist" aria-label="Görünüm">
          {(
            [
              ["people", "Primler"],
              ["docs", "Belgeler ve hedefler"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={cn("flex items-center gap-2 rounded-md px-3.5 py-1.5 font-medium transition-colors", view === k ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
              {k === "docs" && pendingTotal > 0 ? <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-900">{pendingTotal}</span> : null}
            </button>
          ))}
        </div>
        <span className="text-sm">
          <span className="text-muted-foreground">Ödenen </span>
          <b className="text-base tabular-nums">
            {t.p2_settled_count} / {t.p2_lines}
          </b>
        </span>
        <span className="text-sm">
          <span className="text-muted-foreground">Ödenecek </span>
          <b className={cn("text-base tabular-nums", t.p2_due > 0.5 ? "text-amber-800" : "text-emerald-700")}>{money(t.p2_due)} ₺</b>
        </span>
        <span className="text-sm">
          <span className="text-muted-foreground">Ödendi </span>
          <b className="text-base tabular-nums">{money(t.p2_paid)} ₺</b>
        </span>
      </div>

      {view === "people" ? (
        <>
          {otDiffs.length > 0 && !closed ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50/60 px-5 py-3 text-sm text-sky-950">
              <span className="min-w-0 flex-1">
                Kolay İK’da onaylı mesaisi bordrodan farklı <b>{otDiffs.length} kişi</b> var: {otDiffs.slice(0, 4).map((x) => x.l.full_name).join(", ")}
                {otDiffs.length > 4 ? ` ve ${otDiffs.length - 4} kişi daha` : ""}.
              </span>
              <Button size="sm" variant="outline" className="bg-background" onClick={applyAll} disabled={applying}>
                {applying ? "Uygulanıyor…" : "Hepsini uygula"}
              </Button>
            </div>
          ) : null}

          {data.stores.map((s) => (
            <StoreExtras
              key={s.store_id}
              store={s}
              closed={closed}
              pendingOpen={pending.get(s.store_id) ?? 0}
              otByLine={otByLine}
              onOpenLine={onOpenLine}
              onTargets={() => setTargets(s.store_id)}
              onDocs={() => setView("docs")}
              onPay={() => onBatch({ kind: "payment2", channel: "cash", store: s.store_name })}
            />
          ))}

          <BatchList data={data} kinds={["payment2"]} title="Ödeme 2 listeleri" onChanged={onChanged} />

          <Disclosure title="İK kayıtları" hint="Kolay İK mesai ve izinleri · pazar ↔ hak günü · Naturel İK kesintileri">
            <div className="space-y-4">
              <KolayikPanel data={kolay.data} loading={kolay.loading} queryError={kolay.error} onRefresh={kolay.refetch} />
              {kolay.data?.configured ? <SundayAuditPanel year={data.period.year} month={data.period.month} /> : null}
              <IkPanel periodId={data.period.id} closed={closed} onChanged={onChanged} />
            </div>
          </Disclosure>
        </>
      ) : (
        <div className="space-y-5">
          <PendingDocs data={data} onChanged={onChanged} />
          {data.stores
            .filter((s) => s.is_mavi)
            .map((s) => {
              const p = perf.data?.find((x) => x.store_id === s.store_id);
              if (!p || (!p.docs.length && !p.check)) return null;
              return (
                <section key={s.store_id} className="overflow-hidden rounded-2xl border bg-card shadow-xs">
                  <header className="border-b px-5 py-3.5">
                    <h3 className="font-semibold tracking-tight">{s.store_name} · çapraz kontrol</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">Yüklenen belgeler birbiriyle ve günlük bayi dosyalarıyla karşılaştırılır; tutuyorsa rakamlar prim tablosuna aktarılır.</p>
                  </header>
                  <PerformanceDocs
                    allowUpload={false}
                    periodId={data.period.id}
                    storeId={s.store_id}
                    closed={closed}
                    perf={p}
                    onChanged={() => void perf.refetch()}
                    onApplied={() => {
                      void perf.refetch();
                      onChanged();
                    }}
                  />
                </section>
              );
            })}
        </div>
      )}

      {targetStore ? (
        <StoreTargetsDialog store={targetStore} periodId={data.period.id} periodLabel={data.period.label} closed={closed} onClose={() => setTargets(null)} onChanged={onChanged} />
      ) : null}
      {bulk ? <BulkEntryDialog data={data} onClose={() => setBulk(false)} onChanged={onChanged} /> : null}
      {starter ? <NewStarterDialog period={data.period} onClose={() => setStarter(false)} onCreated={onChanged} /> : null}
    </div>
  );
}

function StoreExtras({
  store,
  closed,
  pendingOpen,
  otByLine,
  onOpenLine,
  onTargets,
  onDocs,
  onPay,
}: {
  store: StoreBlock;
  closed: boolean;
  pendingOpen: number;
  otByLine: Map<string, Overtime>;
  onOpenLine: (id: string) => void;
  onTargets: () => void;
  onDocs: () => void;
  onPay: () => void;
}) {
  const lines = store.lines.filter((l) => l.employee_status !== "inactive");
  const inactive = store.lines.filter((l) => l.employee_status === "inactive");
  if (lines.length === 0 && inactive.length === 0) return null;
  const due = lines.reduce((s, l) => s + l.calc.payment2_due, 0);
  const paid = lines.reduce((s, l) => s + l.calc.payment2_paid, 0);
  const ach = store.achievement;

  return (
    <StoreShell
      title={store.store_name}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            ciro <span className="tabular-nums text-foreground">{store.revenue != null ? money(store.revenue) : "girilmedi"}</span>
          </span>
          <span>
            hedef <span className="tabular-nums text-foreground">{store.target != null ? money(store.target) : "girilmedi"}</span>
          </span>
          {ach != null ? <b className={cn("tabular-nums", ach >= 1 ? "text-emerald-700" : ach >= 0.95 ? "text-amber-800" : "text-rose-700")}>{pct(ach)}</b> : null}
          {pendingOpen > 0 ? (
            <button type="button" onClick={onDocs} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
              <Chip tone="wait">{pendingOpen} eksik belge / hedef</Chip>
            </button>
          ) : null}
        </span>
      }
      right={
        <>
          <Button size="sm" variant="outline" onClick={onTargets}>
            <Target className="mr-1.5 h-3.5 w-3.5" />
            Ciro ve hedefler
          </Button>
          <div className="text-right text-sm">
            {due > 0.5 ? (
              <>
                <span className="text-muted-foreground">ödenecek </span>
                <b className="text-base font-semibold tabular-nums text-amber-800">{money(due)} ₺</b>
              </>
            ) : paid > 0.005 ? (
              <Chip tone="ok">Ödeme 2 ödendi · {money(paid)} ₺</Chip>
            ) : (
              <span className="text-muted-foreground">henüz prim yok</span>
            )}
            {due > 0.5 && paid > 0.005 ? <div className="text-muted-foreground">ödendi {money(paid)} ₺</div> : null}
          </div>
          {due > 0.5 && !closed ? (
            <Button size="sm" onClick={onPay}>
              Ödendi olarak işle
            </Button>
          ) : null}
        </>
      }
      footer={
        inactive.length ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-muted/30 px-5 py-2.5 text-sm text-muted-foreground">
            Pasif, bu ay ödenmez:
            {inactive.map((l) => (
              <button key={l.id} type="button" className="font-medium text-foreground/80 underline-offset-2 hover:underline" onClick={() => onOpenLine(l.id)}>
                {l.full_name}
              </button>
            ))}
          </div>
        ) : null
      }
    >
      {lines.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] table-fixed text-sm">
            <thead>
              <tr>
                <th className={TH}>Çalışan</th>
                <th className={cn(TH, "w-[13%]")}>Mesai</th>
                <th className={cn(TH, "w-[13%]")}>Satış primi</th>
                <th className={cn(TH, "w-[13%]")}>Diğer primler</th>
                <th className={cn(TH, "w-[13%]")}>Ekleme · kesinti</th>
                <th className={cn(TH, "w-[13%]")}>Ödeme 2</th>
                <th className={cn(TH, "w-10")}>
                  <span className="sr-only">Aç</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <ExtrasRow key={l.id} l={l} ot={otByLine.get(l.id)} onOpen={() => onOpenLine(l.id)} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </StoreShell>
  );
}

function ExtrasRow({ l, ot, onOpen }: { l: ComputedLine; ot: Overtime | undefined; onOpen: () => void }) {
  const c = l.calc;
  const warn = c.flags.filter((f) => f.level !== "info");
  const other = otherPremiums(c);
  const otherParts = [c.top_seller_amount ? "top-seller" : "", c.garment_amount ? `giysi ${l.garment_units}` : "", c.perfume_amount ? `parfüm ${l.perfume_units}` : "", c.extra_premium ? "ek prim" : ""].filter(Boolean);
  const carried = c.entries.some((e) => e.counted && e.category === CARRY_FORWARD_CATEGORY);
  const otDiff = ot && !l.paid_by_day ? overtimeApplyDecision(ot, l.overtime_hours) : null;
  const depo = isOvertimeOnlyPosition(l.position);
  return (
    <tr className={ROW} tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <td className={TD}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
          {l.full_name}
          {c.commission.special ? <Chip tone="carry">ÖZEL</Chip> : null}
          {l.employee_status === "left" ? <Chip tone="muted">ayrıldı</Chip> : null}
          {warn.length ? <Chip tone={warn.some((w) => w.level === "error") ? "bad" : "wait"}>{warn.length} uyarı</Chip> : null}
        </div>
        <div className="text-sm text-muted-foreground">{l.position}</div>
      </td>
      <td className={TD}>
        {c.overtime_amount > 0.005 ? (
          <>
            {money(c.overtime_amount)}
            <div className="text-sm text-muted-foreground">{l.paid_by_day ? `${hoursTr(l.worked_days ?? 0)} gün` : `${hoursTr(l.overtime_hours)} saat`}</div>
          </>
        ) : (
          <Dash />
        )}
        {otDiff?.mode === "apply" && ot && (ot.approved_hours > 0 || l.overtime_hours > 0) ? <div className="text-sm text-sky-800">Kolay İK {hoursTr(ot.approved_hours)} saat</div> : null}
      </td>
      <td className={TD}>
        {l.commission_profile === "none" ? (
          depo ? <span className="text-muted-foreground">prim yok</span> : <Dash />
        ) : c.commission.final > 0.005 ? (
          <>
            {money(c.commission.final)}
            <div className={cn("text-sm", c.commission.achievement_used != null && c.commission.achievement_used >= 1 ? "text-emerald-700" : "text-muted-foreground")}>
              {c.commission.achievement_used != null ? pct(c.commission.achievement_used) : ""}
              {c.commission.overridden ? " elle" : ""}
            </div>
          </>
        ) : (
          <span className="text-amber-800">{c.commission.basis > 0 ? (c.commission.target ? "0,00" : "hedef bekliyor") : "ciro bekliyor"}</span>
        )}
      </td>
      <td className={TD}>
        {other > 0.005 ? (
          <>
            {money(other)}
            <div className="text-sm text-muted-foreground">{otherParts.join(" · ")}</div>
          </>
        ) : (
          <Dash />
        )}
      </td>
      <td className={TD}>
        {c.additions_total > 0.005 ? <div className="text-emerald-700">+ {money(c.additions_total)}</div> : null}
        {c.deductions_from_extras > 0.005 ? <div className="text-rose-700">− {money(c.deductions_from_extras)}</div> : null}
        {carried ? <div className="text-sm text-violet-800">devir → {money(c.carried_forward_total)}</div> : null}
        {c.additions_total <= 0.005 && c.deductions_from_extras <= 0.005 && !carried ? <Dash /> : null}
      </td>
      <td className={TD}>
        {c.net_remaining < -0.5 ? (
          <>
            <span className="font-semibold text-rose-700">− {money(-c.net_remaining)}</span>
            <div className="text-sm text-rose-700">{l.employee_status === "left" ? "borç" : c.deductions_total > 0.005 ? "kesilemedi" : "fazla ödendi"}</div>
          </>
        ) : c.payment2_due > 0.5 ? (
          <>
            <span className="text-base font-semibold">{money(c.payment2_due)}</span>
            {c.payment2_paid > 0.005 ? <div className="text-sm text-muted-foreground">ödendi {money(c.payment2_paid)}</div> : !c.base_paid && !l.paid_by_day ? <div className="text-sm text-amber-800">maaş da bekliyor</div> : null}
          </>
        ) : c.payment2_paid > 0.005 ? (
          <>
            {money(c.payment2_paid)}
            <div className="text-sm font-medium text-emerald-700">ödendi</div>
          </>
        ) : (
          <Dash />
        )}
      </td>
      <td className={cn(TD, "w-10 pl-0 text-muted-foreground")}>
        <ChevronRight className="ml-auto h-4 w-4" aria-hidden />
      </td>
    </tr>
  );
}
