"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CornerDownRight, Minus, Plus, Save } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import type { ComputedLine, PeriodView, StoreBlock } from "@/server/services/payroll/period";
import { computeLine, type LineInput } from "@/server/services/payroll/compute";
import {
  ADDITION_CATEGORIES,
  CARRY_FORWARD_CATEGORY,
  CARRY_FORWARD_LABEL,
  DEDUCTION_CATEGORIES,
  isOvertimeOnlyPosition,
  periodLabel,
} from "@/server/services/payroll/rules";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { hoursTr, money, nextMonthOf, pct } from "./format";
import { EntryDialog, type EntryKind } from "./entry-dialog";
import { KolayikPanel } from "./kolayik-panel";
import { SundayAuditPanel } from "./sunday-audit";
import { PerformanceDocs } from "./performance-docs";
import type { KolayikMonth } from "@/server/services/kolayik/payroll-sync";

/**
 * Prim ve mesai girişi (Ödeme 2 çalışma alanı).
 *
 * Sahibi (02.10.2026): maaşlar ödendikten sonra herkesin gerçek primini
 * hatasız hesaplamak için rahat bir alan — mesai saatini yazınca tutar
 * (net baz ÷ 26 gün ÷ 8 saat), ciro ve hedefi yazınca komisyon kendiliğinden
 * hesaplanır; kasa eksiği, fiyat farkı, faturasız masraf gibi kesintiler ve
 * eklemeler satırdan girilir. Hesap ekranda yazarken aynı motorla
 * (compute.ts) yapılır, "Kaydet" ile işlenir.
 *
 * Mağaza başlığındaki "bu ay kasa eksiği / faturasız masraf" rozetleri sahibinin
 * isteğiyle KAPALI (03.10.2026: "şimdilik bu bilgileri ben manuel girerim");
 * payroll.storeHints sorgusu duruyor, istenirse yeniden bağlanır.
 */

type Draft = {
  overtime_hours: string;
  overtime_note: string;
  own_revenue_nd: number | undefined;
  own_revenue_denim: number | undefined;
  own_revenue: number | undefined;
  own_target: number | undefined;
  perfume_units: string;
  garment_units: string;
  top_seller: boolean;
  extra_premium: number | undefined;
  extra_premium_note: string;
};

function fromLine(l: ComputedLine): Draft {
  return {
    overtime_hours: l.overtime_hours ? String(l.overtime_hours) : "",
    overtime_note: l.overtime_note ?? "",
    own_revenue_nd: l.own_revenue_nd ?? undefined,
    own_revenue_denim: l.own_revenue_denim ?? undefined,
    own_revenue: l.own_revenue ?? undefined,
    own_target: l.own_target ?? undefined,
    perfume_units: l.perfume_units ? String(l.perfume_units) : "",
    garment_units: l.garment_units ? String(l.garment_units) : "",
    top_seller: l.top_seller,
    extra_premium: l.extra_premium || undefined,
    extra_premium_note: l.extra_premium_note ?? "",
  };
}
const numOf = (s: string) => (s.trim() === "" ? 0 : Number(s.replace(",", ".")) || 0);
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

function toInput(l: ComputedLine, d: Draft): LineInput {
  return {
    base_salary: l.base_salary,
    commission_profile: l.commission_profile,
    overtime_hours: numOf(d.overtime_hours),
    own_revenue_nd: d.own_revenue_nd ?? null,
    own_revenue_denim: d.own_revenue_denim ?? null,
    own_revenue: d.own_revenue ?? null,
    own_target: d.own_target ?? null,
    achievement_accepted: l.achievement_accepted,
    commission_override: l.commission_override,
    commission_note: l.commission_note,
    perfume_units: Math.round(numOf(d.perfume_units)),
    garment_units: Math.round(numOf(d.garment_units)),
    top_seller: d.top_seller,
    extra_premium: d.extra_premium ?? 0,
    extra_premium_note: d.extra_premium_note || null,
    paid_month_early: l.paid_month_early,
    status: l.employee_status,
  };
}

const CAT_LABEL: Record<string, string> = { ...DEDUCTION_CATEGORIES, ...ADDITION_CATEGORIES, [CARRY_FORWARD_CATEGORY]: CARRY_FORWARD_LABEL };

export function ExtrasGrid({
  data,
  closed,
  onChanged,
  onOpenLine,
}: {
  data: PeriodView;
  closed: boolean;
  onChanged: () => void;
  onOpenLine: (id: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [entry, setEntry] = useState<{ line: ComputedLine; kind: EntryKind } | null>(null);
  const [saving, setSaving] = useState(false);
  const update = trpc.payroll.lines.update.useMutation();
  const confirm = useConfirm();
  // Kesinti o ayın ekstrasını aşınca: eksi bakiye sonraki ayın maaşına taşınır.
  const nextMonth = nextMonthOf(data.period.year, data.period.month);
  const nextLabel = periodLabel(nextMonth.year, nextMonth.month);
  const carry = trpc.payroll.entries.carryForward.useMutation({
    onSuccess: (r) => {
      toast.success(`${money(r.amount)} ₺ ${r.to_label} maaşına devredildi`);
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const askCarry = async (l: ComputedLine) => {
    const amount = -l.calc.net_remaining;
    if (
      await confirm({
        title: `${money(amount)} ₺ ${nextLabel} maaşına devredilsin mi?`,
        description: `${l.full_name}: bu ay kesilemeyen tutar ${nextLabel} maaşından düşülür ve bu ayın satırı kapanır. İki kayıt birbirine bağlıdır; biri iptal edilirse diğeri de iptal olur.`,
        confirmLabel: "Devret",
      })
    ) {
      carry.mutate({ id: l.id });
    }
  };
  // Kolay İK: ayın onaylı mesaileri (öneri) ve izinleri (bilgi). Anahtar yoksa panel görünmez.
  // Ay sonu performans belgeleri (Mavi) — yükleme + çapraz kontrol + aktarım
  const perf = trpc.payroll.performance.get.useQuery({ period_id: data.period.id });
  const kolay = trpc.payroll.kolayik.month.useQuery(
    { year: data.period.year, month: data.period.month },
    { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false }
  );
  const otByLine = new Map((kolay.data?.overtime ?? []).filter((o) => o.line_id).map((o) => [o.line_id!, o]));

  const allLines = data.stores.flatMap((s) => s.lines);
  const draftOf = (l: ComputedLine) => drafts[l.id] ?? fromLine(l);
  const isDirty = (l: ComputedLine) => !!drafts[l.id] && !same(drafts[l.id]!, fromLine(l));
  const dirtyLines = allLines.filter(isDirty);
  const patch = (l: ComputedLine, p: Partial<Draft>) => setDrafts((m) => ({ ...m, [l.id]: { ...draftOf(l), ...p } }));

  const payload = (l: ComputedLine, d: Draft) => ({
    id: l.id,
    overtime_hours: numOf(d.overtime_hours),
    overtime_note: d.overtime_note || null,
    own_revenue_nd: l.commission_profile === "mavi_asistan" ? (d.own_revenue_nd ?? null) : undefined,
    own_revenue_denim: l.commission_profile === "mavi_asistan" ? (d.own_revenue_denim ?? null) : undefined,
    own_revenue: l.commission_profile === "deri_asistan" ? (d.own_revenue ?? null) : undefined,
    own_target:
      l.commission_profile === "mavi_asistan" || l.commission_profile === "deri_asistan" ? (d.own_target ?? null) : undefined,
    perfume_units: Math.round(numOf(d.perfume_units)),
    garment_units: Math.round(numOf(d.garment_units)),
    top_seller: d.top_seller,
    extra_premium: d.extra_premium ?? 0,
    extra_premium_note: d.extra_premium_note || null,
  });

  const saveLines = async (lines: ComputedLine[]) => {
    if (lines.length === 0) return;
    setSaving(true);
    try {
      for (const l of lines) await update.mutateAsync(payload(l, draftOf(l)));
      setDrafts((m) => {
        const next = { ...m };
        for (const l of lines) delete next[l.id];
        return next;
      });
      toast.success(lines.length === 1 ? `${lines[0]!.full_name} kaydedildi` : `${lines.length} kişi kaydedildi`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };


  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm shadow-xs">
        <div className="text-muted-foreground">
          Mesai saat ücreti = <b className="text-foreground">net baz ÷ 26 gün ÷ 8 saat</b>. Pazar ve resmî tatilde girilen 8 saat hak günüdür, ücrete girmez;
          yalnız üstü ödenir. Yazdıkça hesaplanır;{" "}
          <b className="text-foreground">Kaydet</b> deyince işlenir. Kasa eksiği, fiyat farkı ve faturasız masraf kesintileri satırdaki{" "}
          <b className="text-foreground">− Kesinti</b> ile girilir.
        </div>
        <div className="flex-1" />
        <Button size="sm" onClick={() => saveLines(dirtyLines)} disabled={saving || closed || dirtyLines.length === 0}>
          <Save className="h-4 w-4 mr-2" />
          Tümünü kaydet{dirtyLines.length ? ` (${dirtyLines.length})` : ""}
        </Button>
      </div>

      <KolayikPanel data={kolay.data} loading={kolay.isFetching} queryError={kolay.error?.message ?? null} onRefresh={() => void kolay.refetch()} />
      {kolay.data?.configured ? <SundayAuditPanel year={data.period.year} month={data.period.month} /> : null}

      {data.stores.map((s) => (
        <StoreExtras
          key={s.store_id}
          store={s}
          overtimeOf={(id) => otByLine.get(id)}
          periodId={data.period.id}
          perf={perf.data?.find((x) => x.store_id === s.store_id)}
          onPerfChanged={() => void perf.refetch()}
          onPerfApplied={() => {
            // Aktarılan mağazanın kaydedilmemiş taslakları belgedeki rakamlarla çakışmasın
            setDrafts((m) => {
              const next = { ...m };
              for (const l of s.lines) delete next[l.id];
              return next;
            });
            void perf.refetch();
            onChanged();
          }}
          closed={closed}
          saving={saving}
          draftOf={draftOf}
          isDirty={isDirty}
          patch={patch}
          onSave={(l) => saveLines([l])}
          onEntry={(line, kind) => setEntry({ line, kind })}
          onOpenLine={onOpenLine}
          onCarry={askCarry}
          carrying={carry.isPending}
          nextLabel={nextLabel}
        />
      ))}

      {entry ? (
        <EntryDialog
          lineId={entry.line.id}
          employeeId={entry.line.employee_id}
          fullName={entry.line.full_name}
          kind={entry.kind}
          onClose={() => setEntry(null)}
          onCreated={onChanged}
        />
      ) : null}
    </div>
  );
}

function StoreExtras({
  store,
  overtimeOf,
  periodId,
  perf,
  onPerfChanged,
  onPerfApplied,
  closed,
  saving,
  draftOf,
  isDirty,
  patch,
  onSave,
  onEntry,
  onOpenLine,
  onCarry,
  carrying,
  nextLabel,
}: {
  store: StoreBlock;
  overtimeOf: (lineId: string) => KolayikMonth["overtime"][number] | undefined;
  periodId: string;
  perf: React.ComponentProps<typeof PerformanceDocs>["perf"];
  onPerfChanged: () => void;
  onPerfApplied: () => void;
  closed: boolean;
  saving: boolean;
  draftOf: (l: ComputedLine) => Draft;
  isDirty: (l: ComputedLine) => boolean;
  patch: (l: ComputedLine, p: Partial<Draft>) => void;
  onSave: (l: ComputedLine) => void;
  onEntry: (l: ComputedLine, kind: EntryKind) => void;
  onOpenLine: (id: string) => void;
  onCarry: (l: ComputedLine) => void;
  carrying: boolean;
  nextLabel: string;
}) {
  const lines = store.lines.filter((l) => l.employee_status !== "inactive");
  if (lines.length === 0) return null;
  const storeIn = { revenue: store.revenue, target: store.target };
  const live = lines.map((l) => ({ l, c: computeLine(toInput(l, draftOf(l)), storeIn, l.calc.entries) }));
  const totalP2 = live.reduce((s, x) => s + x.c.payment2_due, 0);

  return (
    <section className="rounded-2xl border bg-card shadow-xs overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/30 px-4 py-3">
        <div>
          <div className="font-semibold tracking-tight">{store.store_name}</div>
          <div className="text-xs text-muted-foreground">
            Mağaza cirosu {store.revenue != null ? money(store.revenue) : "—"} · merkez hedefi {store.target != null ? money(store.target) : "—"}
            {store.achievement != null ? ` · başarı ${pct(store.achievement)}` : ""} (Genel bakış sekmesinden girilir)
          </div>
        </div>
        <div className="ml-auto text-right text-xs">
          <div className="uppercase tracking-wider text-muted-foreground">Ödeme 2 toplamı</div>
          <div className="text-sm font-semibold tabular-nums">{money(totalP2)} ₺</div>
        </div>
      </header>
      {store.is_mavi ? (
        <PerformanceDocs periodId={periodId} storeId={store.store_id} closed={closed} perf={perf} onChanged={onPerfChanged} onApplied={onPerfApplied} />
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2 text-left font-medium">Çalışan</th>
              <th className="px-2 py-2 text-left font-medium">Mesai (saat)</th>
              <th className="px-2 py-2 text-left font-medium">Ciro</th>
              <th className="px-2 py-2 text-left font-medium">Hedef</th>
              <th className="px-2 py-2 text-right font-medium">Komisyon</th>
              <th className="px-2 py-2 text-left font-medium">Primler</th>
              <th className="px-2 py-2 text-left font-medium">Ekleme / kesinti</th>
              <th className="px-2 py-2 text-right font-medium">Ödeme 2</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {live.map(({ l, c }) => {
              const d = draftOf(l);
              const p = l.commission_profile;
              const dirty = isDirty(l);
              const adjustments = c.entries.filter((e) => (e.kind === "deduction" || e.kind === "addition") && e.counted);
              const isStoreBased = p === "mavi_mudur" || p === "mavi_vice" || p === "deri_mudur";
              // Depo: prim yok — Ödeme 2 = mesai − kesintiler (rules.ts). Eskiden
              // girilmiş bir ek prim varsa görünür kalır ki silinebilsin.
              const overtimeOnly = isOvertimeOnlyPosition(l.position) && !d.extra_premium;
              return (
                <tr key={l.id} className={cn("border-b last:border-0 align-top", dirty && "bg-amber-50/40")}>
                  <td className="px-4 py-2.5">
                    <button type="button" className="text-left hover:underline" onClick={() => onOpenLine(l.id)}>
                      <div className="font-medium leading-tight">{l.full_name}</div>
                    </button>
                    <div className="text-[11px] text-muted-foreground">
                      {l.position} · saatlik {money(c.hourly_rate)} ₺
                    </div>
                    {!c.base_paid ? <div className="text-[10px] text-amber-800">maaş henüz ödenmedi</div> : null}
                  </td>
                  <td className="px-2 py-2.5">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min={0}
                      value={d.overtime_hours}
                      onChange={(e) => patch(l, { overtime_hours: e.target.value })}
                      className="h-8 w-20 text-right"
                      placeholder="0"
                      disabled={closed}
                    />
                    <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{c.overtime_amount ? `= ${money(c.overtime_amount)} ₺` : " "}</div>
                    {(() => {
                      const ot = overtimeOf(l.id);
                      if (!ot || (ot.approved_hours <= 0 && ot.waiting_hours <= 0 && ot.credit_days <= 0)) return null;
                      const current = numOf(d.overtime_hours);
                      const differs = Math.abs(ot.approved_hours - current) > 0.001;
                      // Pazar / tatil 8 saati hak günüdür, ücrete girmez — öneri yalnız ödenecek saattir.
                      // Ödenecek saatin pazar kısmı (8 saatin üstü) ayrıca gösterilir.
                      const sundayPart = ot.sunday_extra_hours;
                      const otherPart = Math.round((ot.approved_hours - sundayPart) * 100) / 100;
                      const onlySundayApplied = differs && sundayPart > 0 && Math.abs(current - sundayPart) < 0.001;
                      return (
                        <div className="mt-0.5 text-[11px] text-sky-800" title={ot.note || undefined}>
                          Kolay İK: {hoursTr(ot.approved_hours)} s ödenecek
                          {sundayPart > 0 ? (otherPart > 0 ? ` (pazar 8 saat üstü ${hoursTr(sundayPart)} + diğer günler ${hoursTr(otherPart)})` : " (pazar 8 saat üstü)") : ""}
                          {ot.credit_days ? ` · ${ot.credit_days} hak günü ayrı` : ""}
                          {ot.short_sunday_records ? ` · ${ot.short_sunday_records} pazarda yalnız ek saat yazılmış` : ""}
                          {onlySundayApplied ? " · şu an yalnız pazar kısmı işli" : ""}
                          {ot.waiting_hours ? ` · ${hoursTr(ot.waiting_hours)} s bekliyor` : ""}
                          {ot.review ? " · ⚠ hafta içi 8+ saat" : ""}
                          {differs && (ot.approved_hours > 0 || numOf(d.overtime_hours) > 0) && !closed ? (
                            <button
                              type="button"
                              className="ml-1 underline"
                              onClick={() => patch(l, { overtime_hours: String(ot.approved_hours), overtime_note: ot.note })}
                            >
                              uygula
                            </button>
                          ) : null}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-2 py-2.5">
                    {p === "mavi_asistan" ? (
                      <div className="space-y-1">
                        <MoneyInput value={d.own_revenue_nd} onChange={(v) => patch(l, { own_revenue_nd: v })} placeholder="denim dışı" className="h-8 w-32 text-right" disabled={closed} />
                        <MoneyInput value={d.own_revenue_denim} onChange={(v) => patch(l, { own_revenue_denim: v })} placeholder="denim" className="h-8 w-32 text-right" disabled={closed} />
                      </div>
                    ) : p === "deri_asistan" ? (
                      <MoneyInput value={d.own_revenue} onChange={(v) => patch(l, { own_revenue: v })} placeholder="kendi cirosu" className="h-8 w-32 text-right" disabled={closed} />
                    ) : isStoreBased ? (
                      <span className="text-xs text-muted-foreground">mağaza cirosu</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    {p === "mavi_asistan" || p === "deri_asistan" ? (
                      <MoneyInput value={d.own_target} onChange={(v) => patch(l, { own_target: v })} placeholder="kişisel hedef" className="h-8 w-32 text-right" disabled={closed} />
                    ) : isStoreBased ? (
                      <span className="text-xs text-muted-foreground">mağaza hedefi</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {p === "none" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <>
                        <div className="font-medium">{money(c.commission.final)}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {c.commission.achievement_used != null ? pct(c.commission.achievement_used) : "hedef?"}
                          {c.commission.special ? " · ÖZEL" : ""}
                          {c.commission.overridden ? " · elle" : ""}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {l.perfume_eligible || l.perfume_units > 0 ? (
                        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          parfüm
                          <Input type="number" inputMode="numeric" min={0} value={d.perfume_units} onChange={(e) => patch(l, { perfume_units: e.target.value })} className="h-8 w-16 text-right" placeholder="0" disabled={closed} />
                        </label>
                      ) : null}
                      {l.garment_eligible || l.garment_units > 0 ? (
                        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          giysi
                          <Input type="number" inputMode="numeric" min={0} value={d.garment_units} onChange={(e) => patch(l, { garment_units: e.target.value })} className="h-8 w-16 text-right" placeholder="0" disabled={closed} />
                        </label>
                      ) : null}
                      {store.is_mavi && p !== "none" ? (
                        <label className="flex items-center gap-1 text-[11px] text-muted-foreground" title="Ayın en çok satanı — 3.000 ₺">
                          <input type="checkbox" className="h-4 w-4" checked={d.top_seller} onChange={(e) => patch(l, { top_seller: e.target.checked })} disabled={closed} />
                          top-seller
                        </label>
                      ) : null}
                    </div>
                    {overtimeOnly ? (
                      <div className="text-[11px] leading-snug text-muted-foreground">
                        prim yok
                        <br />
                        yalnız mesai eklenir, kesinti düşülür
                      </div>
                    ) : (
                      <div className="mt-1 flex items-center gap-1.5">
                        <MoneyInput value={d.extra_premium} onChange={(v) => patch(l, { extra_premium: v })} placeholder="ek prim" className="h-8 w-28 text-right" disabled={closed} />
                        {d.extra_premium ? (
                          <Input value={d.extra_premium_note} onChange={(e) => patch(l, { extra_premium_note: e.target.value })} placeholder="açıklama" className="h-8 w-40" disabled={closed} />
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {adjustments.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => onOpenLine(l.id)}
                          title={e.note ?? ""}
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[11px] ring-1",
                            e.category === CARRY_FORWARD_CATEGORY
                              ? "bg-violet-50 text-violet-800 ring-violet-200/70"
                              : e.kind === "deduction"
                                ? "bg-rose-50 text-rose-800 ring-rose-200/70"
                                : "bg-sky-50 text-sky-800 ring-sky-200/70"
                          )}
                        >
                          {e.category === CARRY_FORWARD_CATEGORY ? (
                            <>
                              {money(e.amount)} → {nextLabel} maaşına devredildi
                            </>
                          ) : (
                            <>
                              {e.kind === "deduction" ? "−" : "+"}
                              {money(e.amount)} {CAT_LABEL[e.category ?? ""] ?? ""}
                            </>
                          )}
                        </button>
                      ))}
                    </div>
                    {!closed ? (
                      <div className="mt-1 flex gap-1">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onEntry(l, "deduction")}>
                          <Minus className="h-3 w-3 mr-1" />
                          Kesinti
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onEntry(l, "addition")}>
                          <Plus className="h-3 w-3 mr-1" />
                          Ekleme
                        </Button>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    <div className={cn("font-semibold", c.net_remaining < -0.5 && "text-rose-700")}>{money(c.payment2_due)}</div>
                    <div className="text-[11px] text-muted-foreground">
                      ekstra {money(c.extras_total)}
                      {c.deductions_total ? ` · kesinti −${money(c.deductions_total)}` : ""}
                      {c.carried_forward_total ? ` · devredilen ${money(c.carried_forward_total)}` : ""}
                    </div>
                    {c.net_remaining < -0.5 ? (
                      <>
                        <div className="text-[10px] text-rose-700">
                          {c.deductions_total > 0.005 ? "bu ay kesilemeyen" : "fazla ödenen"}: {money(-c.net_remaining)}
                        </div>
                        {!closed ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-1 h-7 px-2 text-xs"
                            onClick={() => onCarry(l)}
                            disabled={carrying || dirty}
                            title={dirty ? "Önce satırı kaydedin" : `Eksi tutarı ${nextLabel} maaşından düş`}
                          >
                            <CornerDownRight className="h-3 w-3 mr-1" />
                            Sonraki aya devret
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {dirty ? (
                      <Button size="sm" className="h-8" onClick={() => onSave(l)} disabled={saving || closed}>
                        Kaydet
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
