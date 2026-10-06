"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CornerDownRight, FileUp, Minus, Plus, Save } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import type { ComputedLine, PeriodView, StoreBlock } from "@/server/services/payroll/period";
import { computeLine, type LineCalc, type LineInput } from "@/server/services/payroll/compute";
import {
  ADDITION_CATEGORIES,
  CARRY_FORWARD_CATEGORY,
  CARRY_FORWARD_LABEL,
  DEDUCTION_CATEGORIES,
  GARMENT_PREMIUM_PER_UNIT,
  isOvertimeOnlyPosition,
  periodLabel,
} from "@/server/services/payroll/rules";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { hoursTr, money, nextMonthOf, pct } from "./format";
import { overtimeApplyDecision } from "./overtime-apply";
import { EntryDialog, type EntryKind } from "./entry-dialog";
import { KolayikPanel } from "./kolayik-panel";
import { SundayAuditPanel } from "./sunday-audit";
import { PerformanceDocs, type PerformanceDocsHandle } from "./performance-docs";
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

/**
 * Kayıt türüne göre sebep etiketi. Kesinti ve ekleme sözlüklerinin ikisinde de
 * "other" anahtarı var; tek sözlükte birleştirilince kesintinin "Diğer kesinti"si
 * "Diğer ek hak ediş" olarak görünüyordu (Oğuzhan Özçetin, 07.10.2026).
 */
function categoryLabel(kind: "deduction" | "addition" | "advance" | "payment", category: string | null): string {
  if (category === CARRY_FORWARD_CATEGORY) return CARRY_FORWARD_LABEL;
  const dict: Record<string, string> = kind === "deduction" ? DEDUCTION_CATEGORIES : kind === "addition" ? ADDITION_CATEGORIES : {};
  return dict[category ?? ""] ?? (kind === "deduction" ? "Kesinti" : "Ek hak ediş");
}

/**
 * Ödeme 2 dökümü: satırın ekranda görünen bütün kalemleri alt alta, en altta
 * kişiye ödenecek tutar. Kalemlerin toplamı Ödeme 2'den farklıysa fark tek
 * satırla açıklanır: baz maaş tam ödenmemişse ödenmeyen kısım Ödeme 2'ye eklenir
 * ("Ödenmeyen maaş bakiyesi"); ekleme/kesintinin Ödeme 1'de karşılanan kısmı
 * Ödeme 2'den çıkar ("Ödeme 1 ile ödenir" — compute.ts: ekler ve kesintiler önce
 * baz maaşa işler).
 */
function Payment2Breakdown({ c, hours, nextLabel }: { c: LineCalc; hours: number; nextLabel: string }) {
  const rows: { label: string; amount: number; tone?: string }[] = [];
  if (c.commission.final) rows.push({ label: "Komisyon", amount: c.commission.final });
  if (c.top_seller_amount) rows.push({ label: "Top-seller", amount: c.top_seller_amount });
  if (c.garment_amount) rows.push({ label: "Giysi primi", amount: c.garment_amount });
  if (c.perfume_amount) rows.push({ label: "Parfüm primi", amount: c.perfume_amount });
  if (c.extra_premium) rows.push({ label: "Ek prim", amount: c.extra_premium });
  if (c.overtime_amount) rows.push({ label: `Mesai ${hoursTr(hours)} s`, amount: c.overtime_amount });
  if (c.additions_total) rows.push({ label: "Eklemeler", amount: c.additions_total, tone: "text-emerald-700" });
  if (c.deductions_from_extras) rows.push({ label: "Kesintiler", amount: -c.deductions_from_extras, tone: "text-rose-700" });
  if (c.carried_forward_total) rows.push({ label: `${nextLabel} maaşına devir`, amount: c.carried_forward_total, tone: "text-violet-800" });
  const listed = rows.reduce((s, r) => s + r.amount, 0);
  const diff = Math.round((c.payment2_due - listed) * 100) / 100;
  if (Math.abs(diff) > 0.005)
    rows.push({
      label: diff > 0 ? "Ödenmeyen maaş bakiyesi" : "Ödeme 1 ile ödenir",
      amount: diff,
      tone: "text-amber-800",
    });
  // Maaştan düşülen kesinti bilgi satırıdır, Ödeme 2 toplamına girmez.
  const fromSalary = c.deductions_from_salary;
  return (
    <div className="ml-auto w-[210px]">
      {rows.length ? (
        <dl className="space-y-0.5 text-[11px]">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-2">
              <dt className={cn("truncate text-muted-foreground", r.tone)}>{r.label}</dt>
              <dd className={cn("shrink-0 tabular-nums", r.tone)}>
                {r.amount < 0 ? "− " : "+ "}
                {money(Math.abs(r.amount))}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="text-[11px] text-muted-foreground">kalem yok</div>
      )}
      {fromSalary > 0.005 ? (
        <div className="mt-0.5 text-[10px] text-muted-foreground" title="Bu kesinti baz maaştan (Ödeme 1) düşüldü; Ödeme 2'yi etkilemez.">
          maaştan kesildi {money(fromSalary)} (Ödeme 1)
        </div>
      ) : null}
      <div className={cn("mt-1 flex items-baseline justify-between gap-2 border-t pt-1", c.net_remaining < -0.5 && "text-rose-700")}>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Ödenecek</span>
        <span className="text-base font-bold tabular-nums">{money(c.payment2_due)} ₺</span>
      </div>
    </div>
  );
}

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

  // Sürükle-bırak emniyeti: dosya bir mağaza kutusunun DIŞINA bırakılırsa tarayıcı
  // sayfadan çıkıp dosyayı açar (kaydedilmemiş girişler gider) — bunu engelle.
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
          Soldan sağa: mesai saati → ciro ve hedef → komisyon → primler → mesai ücreti → ekleme / kesinti → <b className="text-foreground">Ödeme 2</b>{" "}
          (kişiye ödenecek tutar, dökümü satırda). Mesai saat ücreti = <b className="text-foreground">net baz ÷ 26 gün ÷ 8 saat</b>; pazar ve resmî tatildeki
          8 saat hak günüdür, yalnız üstü ödenir. Yazdıkça hesaplanır, <b className="text-foreground">Kaydet</b> deyince işlenir. Kesinti ve ekleme sebebi
          satırda yeşil (+) / kırmızı (−) olarak görünür.
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
  // Sürükle-bırak: Mavi mağazasının kutusuna bırakılan dosyalar performans belgesi olarak yüklenir.
  const perfRef = useRef<PerformanceDocsHandle>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const droppable = store.is_mavi && !closed;
  const carriesFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const lines = store.lines.filter((l) => l.employee_status !== "inactive");
  if (lines.length === 0) return null;
  const storeIn = { revenue: store.revenue, target: store.target };
  const live = lines.map((l) => ({ l, c: computeLine(toInput(l, draftOf(l)), storeIn, l.calc.entries) }));
  const totalP2 = live.reduce((s, x) => s + x.c.payment2_due, 0);

  return (
    <section
      data-drop-zone={droppable ? "" : undefined}
      className={cn("relative rounded-2xl border bg-card shadow-xs overflow-hidden", dragDepth > 0 && droppable && "border-sky-400 ring-2 ring-sky-300")}
      onDragEnter={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        setDragDepth((d) => d + 1);
      }}
      onDragOver={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = droppable ? "copy" : "none";
      }}
      onDragLeave={(e) => {
        if (carriesFiles(e)) setDragDepth((d) => Math.max(0, d - 1));
      }}
      onDrop={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        setDragDepth(0);
        if (droppable) perfRef.current?.upload(Array.from(e.dataTransfer.files));
      }}
    >
      {dragDepth > 0 ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm font-medium backdrop-blur-[1px]",
            droppable ? "bg-sky-50/85 text-sky-900" : "bg-muted/80 text-muted-foreground"
          )}
        >
          {droppable ? (
            <>
              <FileUp className="h-4 w-4" />
              Bırakın — {store.store_name} performans belgeleri okunup otomatik hesaplanacak
            </>
          ) : closed ? (
            "Ay kapalı — belge yüklenemez"
          ) : (
            `${store.store_name}: belge gerekmez (ciro Nebim’den gelir)`
          )}
        </div>
      ) : null}
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
        <PerformanceDocs
          ref={perfRef}
          periodId={periodId}
          storeId={store.store_id}
          closed={closed}
          perf={perf}
          hasUnsaved={store.lines.some(isDirty)}
          onChanged={onPerfChanged}
          onApplied={onPerfApplied}
        />
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1380px] text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2 text-left font-medium">Çalışan</th>
              <th className="px-2 py-2 text-left font-medium">Mesai (saat)</th>
              <th className="px-2 py-2 text-left font-medium">Ciro</th>
              <th className="px-2 py-2 text-left font-medium">Hedef</th>
              <th className="px-2 py-2 text-right font-medium">Komisyon</th>
              <th className="px-2 py-2 text-left font-medium">Primler</th>
              <th className="px-2 py-2 text-right font-medium">Mesai ücreti</th>
              <th className="px-2 py-2 text-left font-medium">Ekleme / kesinti</th>
              <th className="px-3 py-2 text-right font-medium">Ödeme 2</th>
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
              const hours = numOf(d.overtime_hours);
              return (
                <tr key={l.id} className={cn("border-b last:border-0 align-top", dirty && "bg-amber-50/40")}>
                  <td className="px-4 py-3">
                    <button type="button" className="text-left hover:underline" onClick={() => onOpenLine(l.id)}>
                      <div className="font-medium leading-tight">{l.full_name}</div>
                    </button>
                    <div className="text-[11px] text-muted-foreground">{l.position}</div>
                    <div className="text-[11px] tabular-nums text-muted-foreground">saatlik {money(c.hourly_rate)} ₺</div>
                    {!c.base_paid ? <div className="mt-0.5 text-[10px] font-medium text-amber-800">maaş henüz ödenmedi</div> : null}
                  </td>
                  <td className="px-2 py-3">
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
                    {(() => {
                      const ot = overtimeOf(l.id);
                      if (!ot || (ot.approved_hours <= 0 && ot.waiting_hours <= 0 && ot.credit_days <= 0)) return null;
                      const current = hours;
                      const differs = Math.abs(ot.approved_hours - current) > 0.001;
                      const decision = overtimeApplyDecision(ot, current);
                      // Pazar / tatil 8 saati hak günüdür, ücrete girmez — öneri yalnız ödenecek saattir.
                      // Ödenecek saatin pazar kısmı (8 saatin üstü) ayrıca gösterilir.
                      const sundayPart = ot.sunday_extra_hours;
                      const otherPart = Math.round((ot.approved_hours - sundayPart) * 100) / 100;
                      const onlySundayApplied = differs && sundayPart > 0 && Math.abs(current - sundayPart) < 0.001;
                      return (
                        <div className="mt-1 max-w-[180px] text-[11px] leading-snug text-sky-800" title={ot.note || undefined}>
                          Kolay İK: {hoursTr(ot.approved_hours)} s ödenecek
                          {sundayPart > 0 ? (otherPart > 0 ? ` (pazar 8 saat üstü ${hoursTr(sundayPart)} + diğer günler ${hoursTr(otherPart)})` : " (pazar 8 saat üstü)") : ""}
                          {ot.credit_days ? ` · ${ot.credit_days} hak günü ayrı` : ""}
                          {ot.short_sunday_records ? ` · ${ot.short_sunday_records} pazarda yalnız ek saat yazılmış` : ""}
                          {onlySundayApplied ? " · şu an yalnız pazar kısmı işli" : ""}
                          {ot.waiting_hours ? ` · ${hoursTr(ot.waiting_hours)} s bekliyor` : ""}
                          {ot.review ? " · ⚠ hafta içi 8+ saat" : ""}
                          {decision.mode === "wait" ? (
                            <span className="ml-1 text-amber-800" title="Bordrodaki saat Kolay İK'daki onaylı saatten fazla; fark bekleyen kayıtlarda. Kolay İK'da onaylayıp paneli yenileyince öneri güncellenir.">
                              · bekleyenler onaylanınca {hoursTr(decision.hours_after_approval)} s olur, şimdi uygulanmaz
                            </span>
                          ) : decision.mode === "apply" && (ot.approved_hours > 0 || hours > 0) && !closed ? (
                            <button
                              type="button"
                              className="ml-1 underline"
                              onClick={() => patch(l, { overtime_hours: String(decision.hours), overtime_note: ot.note })}
                            >
                              uygula
                            </button>
                          ) : null}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-2 py-3">
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
                  <td className="px-2 py-3">
                    {p === "mavi_asistan" || p === "deri_asistan" ? (
                      <MoneyInput value={d.own_target} onChange={(v) => patch(l, { own_target: v })} placeholder="kişisel hedef" className="h-8 w-32 text-right" disabled={closed} />
                    ) : isStoreBased ? (
                      <span className="text-xs text-muted-foreground">mağaza hedefi</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">
                    {p === "none" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <>
                        <div className="font-semibold">{money(c.commission.final)}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {c.commission.achievement_used != null ? pct(c.commission.achievement_used) : "hedef?"}
                          {c.commission.special ? " · ÖZEL" : ""}
                          {c.commission.overridden ? " · elle" : ""}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    {overtimeOnly ? (
                      <div className="text-[11px] leading-snug text-muted-foreground">
                        prim yok
                        <br />
                        yalnız mesai eklenir, kesinti düşülür
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {store.is_mavi && p !== "none" ? (
                          <label
                            className={cn(
                              "flex h-8 w-fit cursor-pointer items-center gap-2 rounded-md border px-2 text-xs transition-colors",
                              d.top_seller ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "text-muted-foreground"
                            )}
                            title="Ayın en çok satanı — 3.000,00 ₺"
                          >
                            <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={d.top_seller} onChange={(e) => patch(l, { top_seller: e.target.checked })} disabled={closed} />
                            top-seller
                            {d.top_seller ? <span className="font-semibold tabular-nums">+{money(c.top_seller_amount)}</span> : null}
                          </label>
                        ) : null}
                        {l.garment_eligible || l.garment_units > 0 ? (
                          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            giysi
                            <Input type="number" inputMode="numeric" min={0} value={d.garment_units} onChange={(e) => patch(l, { garment_units: e.target.value })} className="h-8 w-14 text-right" placeholder="0" disabled={closed} />
                            {c.garment_amount ? <span className="font-medium tabular-nums text-foreground">+{money(c.garment_amount)}</span> : <span>adet × {money(GARMENT_PREMIUM_PER_UNIT)}</span>}
                          </label>
                        ) : null}
                        {l.perfume_eligible || l.perfume_units > 0 ? (
                          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            parfüm
                            <Input type="number" inputMode="numeric" min={0} value={d.perfume_units} onChange={(e) => patch(l, { perfume_units: e.target.value })} className="h-8 w-14 text-right" placeholder="0" disabled={closed} />
                            {c.perfume_amount ? <span className="font-medium tabular-nums text-foreground">+{money(c.perfume_amount)}</span> : null}
                          </label>
                        ) : null}
                        <div className="flex items-center gap-1.5">
                          <MoneyInput value={d.extra_premium} onChange={(v) => patch(l, { extra_premium: v })} placeholder="ek prim" className="h-8 w-28 text-right" disabled={closed} />
                          {d.extra_premium ? (
                            <Input value={d.extra_premium_note} onChange={(e) => patch(l, { extra_premium_note: e.target.value })} placeholder="sebebi (zorunlu)" className={cn("h-8 w-40", !d.extra_premium_note && "border-amber-400")} disabled={closed} />
                          ) : null}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">
                    {hours > 0 ? (
                      <>
                        <div className="font-semibold">{money(c.overtime_amount)}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {hoursTr(hours)} s × {money(c.hourly_rate)}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    {adjustments.length ? (
                      <ul className="min-w-[230px] divide-y rounded-md border text-[12px]">
                        {adjustments.map((e) => {
                          const carried = e.category === CARRY_FORWARD_CATEGORY;
                          const tone = carried ? "text-violet-800" : e.kind === "deduction" ? "text-rose-700" : "text-emerald-700";
                          return (
                            <li key={e.id}>
                              <button
                                type="button"
                                onClick={() => onOpenLine(l.id)}
                                title={e.note ?? ""}
                                className="flex w-full items-center justify-between gap-3 px-2 py-1 text-left hover:bg-muted/40"
                              >
                                <span className={cn("leading-tight", tone)}>
                                  {carried ? `${nextLabel} maaşına devredildi` : categoryLabel(e.kind, e.category)}
                                </span>
                                <span className={cn("shrink-0 font-semibold tabular-nums", tone)}>
                                  {carried ? "→ " : e.kind === "deduction" ? "− " : "+ "}
                                  {money(e.amount)}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <div className="text-[11px] text-muted-foreground">yok</div>
                    )}
                    {!closed ? (
                      <div className="mt-1.5 flex gap-1">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-rose-700 hover:text-rose-800" onClick={() => onEntry(l, "deduction")}>
                          <Minus className="h-3 w-3 mr-1" />
                          Kesinti
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-emerald-700 hover:text-emerald-800" onClick={() => onEntry(l, "addition")}>
                          <Plus className="h-3 w-3 mr-1" />
                          Ekleme
                        </Button>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <Payment2Breakdown c={c} hours={hours} nextLabel={nextLabel} />
                    {c.net_remaining < -0.5 ? (
                      <>
                        <div className="mt-1 text-[11px] font-medium text-rose-700">
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
                  <td className="px-3 py-3 text-right">
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
