"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CornerDownRight, Save } from "lucide-react";
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
  dayPaidBase,
  dayRate,
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
import { IkPanel } from "./ik-panel";
import { StatusToggleButton } from "./status-toggle";
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
  /** Günle ödenen personel: çalıştığı gün (mesai yerine) */
  worked_days: string;
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
    worked_days: l.worked_days != null ? String(l.worked_days) : "",
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

/** Günle ödenenin gün ücreti (sunucudaki hesapla aynı) — maaş değil, Ödeme 2'de mesai gibi. */
function dayPayOf(l: ComputedLine, d: Draft): number {
  return l.paid_by_day && d.worked_days.trim() !== "" ? dayPaidBase(l.card_base_salary, numOf(d.worked_days)) : 0;
}

function toInput(l: ComputedLine, d: Draft): LineInput {
  return {
    // Gün girilince sunucu bazı 0'a çeker; ekranda da aynısı.
    base_salary: l.paid_by_day && d.worked_days.trim() !== "" ? 0 : l.base_salary,
    day_pay: dayPayOf(l, d),
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
function Payment2Breakdown({ c, hours, days, nextLabel }: { c: LineCalc; hours: number; days: number; nextLabel: string }) {
  const rows: { label: string; amount: number; tone?: string }[] = [];
  // Sahibi (03.11.2026): "komisyon demek prim demek" — ekranda satış primi diye geçer.
  if (c.commission.final) rows.push({ label: "Satış primi", amount: c.commission.final });
  if (c.top_seller_amount) rows.push({ label: "Top-seller", amount: c.top_seller_amount });
  if (c.garment_amount) rows.push({ label: "Giysi primi", amount: c.garment_amount });
  if (c.perfume_amount) rows.push({ label: "Parfüm primi", amount: c.perfume_amount });
  if (c.extra_premium) rows.push({ label: "Ek prim", amount: c.extra_premium });
  if (c.day_pay_amount) rows.push({ label: `Gün ücreti ${hoursTr(days)} gün`, amount: c.day_pay_amount });
  const otOnly = Math.round((c.overtime_amount - c.day_pay_amount) * 100) / 100;
  if (otOnly) rows.push({ label: `Mesai ${hoursTr(hours)} s`, amount: otOnly });
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
    <div className="ml-auto w-[220px]">
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
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Ödenecek</span>
        <span className="text-lg font-bold tabular-nums">{money(c.payment2_due)} ₺</span>
      </div>
    </div>
  );
}

export function ExtrasGrid({
  data,
  closed,
  onChanged,
  onOpenLine,
  onPayStore,
}: {
  data: PeriodView;
  closed: boolean;
  onChanged: () => void;
  onOpenLine: (id: string) => void;
  /** Mağazanın Ödeme 2 nakit listesini aç (yalnız o mağaza) — ödendi kaydı oradan */
  onPayStore: (storeName: string) => void;
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
    worked_days: l.paid_by_day ? (d.worked_days.trim() === "" ? null : numOf(d.worked_days)) : undefined,
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
          <b className="text-foreground">Ödeme 2</b> = mesai + satış primi + diğer primler + eklemeler − kesintiler; nakit ödenir. Yazdıkça hesaplanır,{" "}
          <b className="text-foreground">Kaydet</b> ile işlenir.{" "}
          <span
            className="cursor-help underline decoration-dotted underline-offset-2"
            title="Mesai saat ücreti = net baz ÷ 26 gün ÷ 8 saat. Pazar ve resmî tatildeki 8 saat hak günüdür, ücrete girmez; Mavi'de 05.10.2026'dan beri pazar/tatilde üstü de ödenmez. Günle ödenen personelde gün × (baz ÷ 26) mesai gibi Ödeme 2'ye girer."
          >
            kurallar
          </span>
        </div>
        <div className="flex-1" />
        <Button size="sm" onClick={() => saveLines(dirtyLines)} disabled={saving || closed || dirtyLines.length === 0}>
          <Save className="h-4 w-4 mr-2" />
          Tümünü kaydet{dirtyLines.length ? ` (${dirtyLines.length})` : ""}
        </Button>
      </div>

      <KolayikPanel data={kolay.data} loading={kolay.isFetching} queryError={kolay.error?.message ?? null} onRefresh={() => void kolay.refetch()} />
      {kolay.data?.configured ? <SundayAuditPanel year={data.period.year} month={data.period.month} /> : null}
      <IkPanel periodId={data.period.id} closed={closed} onChanged={onChanged} />

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
          onChanged={onChanged}
          onPayStore={() => onPayStore(s.store_name)}
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
  onChanged,
  onPayStore,
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
  onChanged: () => void;
  onPayStore: () => void;
  onCarry: (l: ComputedLine) => void;
  carrying: boolean;
  nextLabel: string;
}) {
  // Belgeler burada yüklenmez — "Bekleyen belgeler" sekmesindeki mağaza kartına bırakılır (sahibi, 02.11.2026).
  const lines = store.lines.filter((l) => l.employee_status !== "inactive");
  // Pasif personel tabloda yer kaplamaz; mağazanın altında adıyla ve "Aktif yap" düğmesiyle durur.
  const inactive = store.lines.filter((l) => l.employee_status === "inactive");
  if (lines.length === 0 && inactive.length === 0) return null;
  const storeIn = { revenue: store.revenue, target: store.target };
  const live = lines.map((l) => ({ l, c: computeLine(toInput(l, draftOf(l)), storeIn, l.calc.entries) }));
  const totalP2 = live.reduce((s, x) => s + x.c.payment2_due, 0);
  // Kayıtlı değerlerle (taslak değil): ödendi kaydı kaydedilmiş satırlardan yapılır.
  const savedDue = lines.reduce((s, l) => s + l.calc.payment2_due, 0);
  const paidP2 = lines.reduce((s, l) => s + l.calc.payment2_paid, 0);
  const storeDirty = lines.some(isDirty);

  return (
    <section className="relative rounded-2xl border bg-card shadow-xs overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/30 px-4 py-3">
        <div>
          <div className="font-semibold tracking-tight">{store.store_name}</div>
          <div className="text-xs text-muted-foreground">
            <span title="Mağaza cirosu ve merkez hedefi Genel bakış sekmesinden girilir" className="cursor-help">
              ciro {store.revenue != null ? money(store.revenue) : "—"} · hedef {store.target != null ? money(store.target) : "—"}
              {store.achievement != null ? ` · ${pct(store.achievement)}` : ""}
            </span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="text-right text-xs">
            <div className="uppercase tracking-wider text-muted-foreground">{paidP2 > 0.005 ? "Ödeme 2 kalan" : "Ödeme 2 toplamı"}</div>
            <div className="text-sm font-semibold tabular-nums">{money(totalP2)} ₺</div>
            {paidP2 > 0.005 ? <div className="tabular-nums text-emerald-700">ödendi {money(paidP2)} ₺</div> : null}
          </div>
          {/* Sahibi (03.11.2026): "Mavi Lefkoşa'yı ödedim ama işaretleme tuşu yok" — nakit listesi bu mağazayla açılır */}
          {savedDue > 0.005 && !closed ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onPayStore}
              disabled={storeDirty}
              title={storeDirty ? "Önce bu mağazadaki değişiklikleri kaydet" : "Ödeme 2 nakit listesi bu mağazayla açılır; tarihi seçip \"Bu mağaza ödendi\" de"}
            >
              Ödendi olarak işle
            </Button>
          ) : paidP2 > 0.005 && savedDue <= 0.005 ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">Ödeme 2 ödendi</span>
          ) : null}
        </div>
      </header>
      {store.is_mavi ? (
        <PerformanceDocs
          allowUpload={false}
          periodId={periodId}
          storeId={store.store_id}
          closed={closed}
          perf={perf}
          hasUnsaved={store.lines.some(isDirty)}
          onChanged={onPerfChanged}
          onApplied={onPerfApplied}
        />
      ) : null}
      <div className={cn("overflow-x-auto", lines.length === 0 && "hidden")}>
        <table className="w-full min-w-[1180px] text-sm">
          <thead className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <tr className="border-b">
              <th className="w-44 px-4 py-2 text-left font-medium">Çalışan</th>
              <th className="w-32 px-2 py-2 text-left font-medium">Mesai</th>
              <th className="w-48 px-2 py-2 text-left font-medium">Ciro · hedef</th>
              <th className="w-48 px-2 py-2 text-left font-medium">Primler</th>
              <th className="w-56 px-2 py-2 text-left font-medium">Ekleme · kesinti</th>
              <th className="px-3 py-2 text-right font-medium">Ödeme 2</th>
              <th className="w-20 px-3 py-2" />
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
              const ach = c.commission.achievement_used;
              return (
                <tr key={l.id} className={cn("border-b last:border-0 align-top", dirty && "bg-amber-50/40")}>
                  {/* Çalışan */}
                  <td className="px-4 py-3">
                    <button type="button" className="text-left hover:underline" onClick={() => onOpenLine(l.id)}>
                      <div className="font-medium leading-tight">{l.full_name}</div>
                    </button>
                    <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {l.position}
                      <br />
                      <span className="whitespace-nowrap tabular-nums">
                        {l.paid_by_day ? `günle · ${money(dayRate(l.card_base_salary))} ₺/gün` : `saatlik ${money(c.hourly_rate)} ₺`}
                      </span>
                    </div>
                    {!c.base_paid && !l.paid_by_day ? <div className="mt-0.5 text-[10px] font-medium text-amber-800">maaş henüz ödenmedi</div> : null}
                    <StatusToggleButton line={l} closed={closed} onChanged={onChanged} className="mt-1.5 h-6 px-1.5 text-[11px] font-normal text-muted-foreground" />
                  </td>

                  {/* Mesai / gün */}
                  <td className="px-2 py-3">
                    {l.paid_by_day ? (
                      <DaysCell value={d.worked_days} onChange={(v) => patch(l, { worked_days: v })} kolayikDays={overtimeOf(l.id)?.full_day_records ?? null} closed={closed} />
                    ) : (
                      <OvertimeCell
                        value={d.overtime_hours}
                        hours={hours}
                        amount={c.overtime_amount}
                        rate={c.hourly_rate}
                        ot={overtimeOf(l.id)}
                        closed={closed}
                        onChange={(v) => patch(l, { overtime_hours: v })}
                        onApply={(h, note) => patch(l, { overtime_hours: h, overtime_note: note })}
                      />
                    )}
                  </td>

                  {/* Ciro · hedef → komisyon */}
                  <td className="px-2 py-3">
                    {p === "none" ? (
                      <span className="text-[11px] text-muted-foreground">satış primi yok</span>
                    ) : (
                      <div className="space-y-1">
                        {p === "mavi_asistan" ? (
                          <>
                            <Labeled k="ND"><MoneyInput value={d.own_revenue_nd} onChange={(v) => patch(l, { own_revenue_nd: v })} placeholder="denim dışı" className="h-8 w-32 text-right" disabled={closed} /></Labeled>
                            <Labeled k="denim"><MoneyInput value={d.own_revenue_denim} onChange={(v) => patch(l, { own_revenue_denim: v })} placeholder="denim" className="h-8 w-32 text-right" disabled={closed} /></Labeled>
                          </>
                        ) : p === "deri_asistan" ? (
                          <Labeled k="ciro"><MoneyInput value={d.own_revenue} onChange={(v) => patch(l, { own_revenue: v })} placeholder="kendi cirosu" className="h-8 w-32 text-right" disabled={closed} /></Labeled>
                        ) : null}
                        {p === "mavi_asistan" || p === "deri_asistan" ? (
                          <Labeled k="hedef"><MoneyInput value={d.own_target} onChange={(v) => patch(l, { own_target: v })} placeholder="kişisel hedef" className="h-8 w-32 text-right" disabled={closed} /></Labeled>
                        ) : isStoreBased ? (
                          <div className="text-[11px] leading-snug text-muted-foreground">mağaza cirosu / hedefi</div>
                        ) : null}
                        <div className="text-[11px] tabular-nums text-muted-foreground">
                          başarı{" "}
                          <span className={cn("font-medium", ach != null && ach >= 1 ? "text-emerald-700" : ach != null ? "text-amber-800" : "")}>{ach != null ? pct(ach) : "hedef?"}</span>
                          {c.commission.special ? " ÖZEL" : ""}
                          {c.commission.overridden ? " elle" : ""}
                        </div>
                      </div>
                    )}
                  </td>

                  {/* Primler */}
                  <td className="px-2 py-3">
                    {overtimeOnly ? (
                      <div className="text-[11px] leading-snug text-muted-foreground">prim yok — yalnız mesai, kesinti düşülür</div>
                    ) : (
                      <div className="space-y-1.5">
                        {p !== "none" ? (
                          <div className="text-[12px] tabular-nums" title={c.commission.explanation.join("\n")}>
                            <span className="text-muted-foreground">satış primi </span>
                            <b>{money(c.commission.final)}</b>
                          </div>
                        ) : null}
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
                          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Outlet ceketler sayılmaz (sahibi, 29.10.2026): eski sezon kodlu ve liste fiyatı 13.000 ₺ altı ceketlere giysi primi yok.">
                            giysi
                            <Input type="number" inputMode="numeric" min={0} value={d.garment_units} onChange={(e) => patch(l, { garment_units: e.target.value })} className="h-8 w-14 text-right" placeholder="0" disabled={closed} />
                            {c.garment_amount ? <span className="font-medium tabular-nums text-foreground">+{money(c.garment_amount)}</span> : <span>× {money(GARMENT_PREMIUM_PER_UNIT)}</span>}
                          </label>
                        ) : null}
                        {l.perfume_eligible || l.perfume_units > 0 ? (
                          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            parfüm
                            <Input type="number" inputMode="numeric" min={0} value={d.perfume_units} onChange={(e) => patch(l, { perfume_units: e.target.value })} className="h-8 w-14 text-right" placeholder="0" disabled={closed} />
                            {c.perfume_amount ? <span className="font-medium tabular-nums text-foreground">+{money(c.perfume_amount)}</span> : null}
                          </label>
                        ) : null}
                        <div className="space-y-1">
                          <Labeled k="ek prim"><MoneyInput value={d.extra_premium} onChange={(v) => patch(l, { extra_premium: v })} placeholder="0,00" className="h-8 w-28 text-right" disabled={closed} /></Labeled>
                          {d.extra_premium ? (
                            <Input value={d.extra_premium_note} onChange={(e) => patch(l, { extra_premium_note: e.target.value })} placeholder="sebebi (zorunlu)" className={cn("h-8 w-full", !d.extra_premium_note && "border-amber-400")} disabled={closed} />
                          ) : null}
                        </div>
                      </div>
                    )}
                  </td>

                  {/* Ekleme · kesinti */}
                  <td className="px-2 py-3">
                    {adjustments.length ? (
                      <ul className="divide-y rounded-md border text-[12px]">
                        {adjustments.map((e) => {
                          const carried = e.category === CARRY_FORWARD_CATEGORY;
                          const tone = carried ? "text-violet-800" : e.kind === "deduction" ? "text-rose-700" : "text-emerald-700";
                          return (
                            <li key={e.id}>
                              <button type="button" onClick={() => onOpenLine(l.id)} title={e.note ?? ""} className="flex w-full items-center justify-between gap-3 px-2 py-1 text-left hover:bg-muted/40">
                                <span className={cn("leading-tight", tone)}>{carried ? `${nextLabel} maaşına devredildi` : categoryLabel(e.kind, e.category)}</span>
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
                      <div className="mt-1.5 flex gap-3 text-[11px]">
                        <button type="button" className="text-rose-700 hover:underline" onClick={() => onEntry(l, "deduction")}>
                          − kesinti
                        </button>
                        <button type="button" className="text-emerald-700 hover:underline" onClick={() => onEntry(l, "addition")}>
                          + ekleme
                        </button>
                      </div>
                    ) : null}
                  </td>

                  {/* Ödeme 2 */}
                  <td className="px-3 py-3 text-right tabular-nums">
                    <Payment2Breakdown c={c} hours={hours} days={numOf(d.worked_days)} nextLabel={nextLabel} />
                    {c.net_remaining < -0.5 ? (
                      <>
                        <div className="mt-1 text-[11px] font-medium text-rose-700">
                          {l.employee_status === "left" ? "borç — iade edecek" : c.deductions_total > 0.005 ? "bu ay kesilemeyen" : "fazla ödenen"}: {money(-c.net_remaining)}
                        </div>
                        {!closed && l.employee_status !== "left" ? (
                          <Button size="sm" variant="outline" className="mt-1 h-7 px-2 text-xs" onClick={() => onCarry(l)} disabled={carrying || dirty} title={dirty ? "Önce satırı kaydedin" : `Eksi tutarı ${nextLabel} maaşından düş`}>
                            <CornerDownRight className="h-3 w-3 mr-1" />
                            Sonraki aya devret
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </td>

                  {/* Kaydet */}
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
      {inactive.length ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
          <span className="uppercase tracking-wider">Pasif · bu ay ödenmez</span>
          {inactive.map((l) => (
            <span key={l.id} className="flex items-center gap-2">
              <button type="button" className="font-medium text-foreground/80 hover:underline" onClick={() => onOpenLine(l.id)}>
                {l.full_name}
              </button>
              <StatusToggleButton line={l} closed={closed} onChanged={onChanged} className="h-6 px-2 text-[11px]" />
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Günle ödenen personelin mesai kutusu yerine GÜN kutusu (Alp, 03.11.2026: "ek mesai saat
 * kısmı yerine girilen rakam gün olsun"). Baz maaş = gün × (kart bazı ÷ 26). Kolay İK'ya
 * çalıştığı günü 8 saat olarak girer; onaylı 8+ saatlik kayıt sayısı öneri olarak görünür.
 */
function DaysCell({
  value,
  onChange,
  kolayikDays,
  closed,
}: {
  value: string;
  onChange: (v: string) => void;
  kolayikDays: number | null;
  closed: boolean;
}) {
  const current = numOf(value);
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="decimal"
          step="1"
          min={0}
          max={31}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-20 text-right"
          placeholder="gün"
          disabled={closed}
        />
        <span className="text-xs text-muted-foreground">gün</span>
      </div>
      {kolayikDays != null ? (
        <div className="mt-1 max-w-[180px] text-[11px] leading-snug text-sky-800">
          Kolay İK: {kolayikDays} gün
          {value.trim() === "" || Math.abs(current - kolayikDays) > 0.001 ? (
            !closed ? (
              <button type="button" className="ml-1 underline" onClick={() => onChange(String(kolayikDays))}>
                uygula
              </button>
            ) : null
          ) : (
            " · bordroda aynı"
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Küçük görünür etiket + alan (yalnız yer tutucu değil — alanın ne olduğu her zaman okunur). */
function Labeled({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="w-12 shrink-0 whitespace-nowrap text-[10px] uppercase tracking-wider text-muted-foreground">{k}</span>
      {children}
    </label>
  );
}

/**
 * Mesai saati kutusu + Kolay İK önerisi tek satırda; ayrıntı (pazar payı, hak günü,
 * bekleyen, uyarı) fareyle üzerine gelince. "uygula" öneriyi ve notunu satıra yazar.
 */
function OvertimeCell({
  value,
  hours,
  amount,
  rate,
  ot,
  closed,
  onChange,
  onApply,
}: {
  value: string;
  hours: number;
  amount: number;
  rate: number;
  ot: KolayikMonth["overtime"][number] | undefined;
  closed: boolean;
  onChange: (v: string) => void;
  onApply: (hours: string, note: string) => void;
}) {
  const has = ot && (ot.approved_hours > 0 || ot.waiting_hours > 0 || ot.credit_days > 0);
  const decision = ot ? overtimeApplyDecision(ot, hours) : null;
  const sundayPart = ot?.sunday_extra_hours ?? 0;
  const otherPart = ot ? Math.round((ot.approved_hours - sundayPart) * 100) / 100 : 0;
  const detail = ot
    ? [
        ot.note,
        sundayPart > 0 ? (otherPart > 0 ? `pazar 8 saat üstü ${hoursTr(sundayPart)} s + diğer günler ${hoursTr(otherPart)} s` : "tamamı pazar 8 saat üstü") : "",
        ot.credit_days ? `${ot.credit_days} pazar/tatil hak günü (ücrete girmez)` : "",
        ot.short_sunday_records ? `${ot.short_sunday_records} pazarda yalnız ek saat yazılmış` : "",
        ot.waiting_hours ? `${hoursTr(ot.waiting_hours)} s onay bekliyor` : "",
        ot.review ? "hafta içi 8+ saatlik kayıt var — elle bakın" : "",
        decision?.mode === "wait" ? `bordrodaki saat bekleyenlerle açıklanıyor; onaylanınca ${hoursTr(decision.hours_after_approval)} s olur` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Input type="number" inputMode="decimal" step="0.5" min={0} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-20 text-right" placeholder="0" disabled={closed} />
        <span className="text-xs text-muted-foreground">s</span>
      </div>
      {hours > 0 ? (
        <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">
          = <b className="text-foreground">{money(amount)}</b> <span className="whitespace-nowrap">({money(rate)}/s)</span>
        </div>
      ) : null}
      {has && ot && decision ? (
        <div className="mt-1 text-[11px] leading-snug text-sky-800" title={detail}>
          <span className="cursor-help underline decoration-dotted underline-offset-2">Kolay İK {hoursTr(ot.approved_hours)} s</span>
          {ot.review || ot.waiting_hours || decision.mode === "wait" ? <span className="ml-1 text-amber-800" title={detail}>⚠</span> : null}
          {decision.mode === "same" ? (
            <span className="ml-1 text-muted-foreground">aynı</span>
          ) : decision.mode === "apply" && (ot.approved_hours > 0 || hours > 0) && !closed ? (
            <button type="button" className="ml-1 underline" onClick={() => onApply(String(decision.hours), ot.note)}>
              uygula
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
