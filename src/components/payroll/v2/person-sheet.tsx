"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronUp, CornerDownRight, ExternalLink, Minus, Plus, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { ComputedLine, StoreBlock } from "@/server/services/payroll/period";
import { computeLine, type AnnotatedEntry, type LineCalc } from "@/server/services/payroll/compute";
import {
  CARRY_FORWARD_CATEGORY,
  dayPaidBase,
  dayRate,
  GARMENT_PREMIUM_PER_UNIT,
  isOvertimeOnlyPosition,
  PAY_METHOD_SHORT,
  PROFILE_LABEL,
  TOP_SELLER_PREMIUM,
  workedDaysInPeriod,
} from "@/server/services/payroll/rules";
import type { KolayikMonth } from "@/server/services/kolayik/payroll-sync";
import { CHANNEL_SHORT, dmy, hoursTr, money, pct } from "../format";
import { EntryDialog, type EntryKind } from "../entry-dialog";
import { overtimeApplyDecision } from "../overtime-apply";
import { StatusToggleButton } from "../status-toggle";
import { draftBase, draftFromLine, draftPayload, draftToInput, numOf, sameDraft, type LineDraft } from "./line-draft";
import { categoryLabel, Chip, otherPremiums, salaryPaid } from "./parts";

type Overtime = KolayikMonth["overtime"][number];
type Tab = "ozet" | "duzenle" | "kayitlar";

/**
 * KİŞİ PANELİ — bir kişinin o ayki her şeyi, sağdan açılır.
 *
 * Üç sekme, her biri tek iş (sahibi, 10.11.2026: "çok pis, kaliteli basit bir
 * görüntü isterim" — ilk sürüm her şeyi tek uzun formda alt alta diziyordu):
 *   Özet     — yalnız okunur hesap dökümü: Maaş (Ödeme 1) ve Prim (Ödeme 2)
 *   Düzenle  — giriş alanları: mesai, ciro/hedef, primler; nadir alanlar "Gelişmiş"te kapalı
 *   Kayıtlar — kesinti/ekleme ve avans/ödeme kayıtları, iptal
 * Hesap yazarken sunucudaki motorla yapılır; üstteki üç rakam hep günceldir.
 */
export function PersonSheet({
  line,
  store,
  period,
  closed,
  nextLabel,
  overtime,
  initialTab = "ozet",
  onPrev,
  onNext,
  onClose,
  onChanged,
}: {
  line: ComputedLine;
  store: StoreBlock;
  period: { year: number; month: number };
  closed: boolean;
  /** Açılış sekmesi — varsayılan Özet */
  initialTab?: Tab;
  /** "Kasım 2026" — sonraki aya devir metinleri için */
  nextLabel: string;
  overtime?: Overtime;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [draft, setDraft] = useState<LineDraft>(() => draftFromLine(line));
  const [entryKind, setEntryKind] = useState<EntryKind | null>(null);
  // Kişi değişince ya da satır kaydedilince taslak sunucudaki değerlere döner.
  // Yalnız kayıt (kesinti, ödeme) eklenince satır değişmez — taslak korunur.
  useEffect(() => setDraft(draftFromLine(line)), [line.id, line.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const saved = useMemo(() => draftFromLine(line), [line]);
  const dirty = !sameDraft(draft, saved);
  const set = <K extends keyof LineDraft>(k: K, v: LineDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const storeIn = { revenue: store.revenue, target: store.target };
  const c: LineCalc = useMemo(
    () => computeLine(draftToInput(line, draft), storeIn, line.calc.entries),
    [line, draft, store.revenue, store.target] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const update = trpc.payroll.lines.update.useMutation({
    onSuccess: () => {
      toast.success(`${line.full_name} kaydedildi`);
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const carry = trpc.payroll.entries.carryForward.useMutation({
    onSuccess: (r) => {
      toast.success(`${money(r.amount)} ₺ ${r.to_label} maaşına devredildi`);
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  const leave = async (go: () => void) => {
    if (
      !dirty ||
      (await confirm({
        title: "Kaydedilmemiş değişiklik var",
        description: `${line.full_name} için yaptığınız değişiklikler kaydedilmedi.`,
        confirmLabel: "Kaydetmeden çık",
        cancelLabel: "Geri dön",
      }))
    )
      go();
  };

  const settled = Math.abs(c.net_remaining) <= 0.5;
  const records = c.entries.filter((e) => !e.voided_at).length;
  const warnings = c.flags.filter((f) => f.level !== "info");
  const infos = c.flags.filter((f) => f.level === "info");

  return (
    <Sheet open onOpenChange={(o) => !o && void leave(onClose)}>
      <SheetContent>
        <header className="shrink-0 px-7 pt-6">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-[22px] font-semibold leading-tight tracking-tight">{line.full_name}</SheetTitle>
              <SheetDescription className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span>
                  {line.position} · {line.store_name} · {PAY_METHOD_SHORT[line.pay_method]}
                </span>
                {line.employee_status === "left" ? <Chip tone="muted">ayrıldı</Chip> : line.employee_status === "inactive" ? <Chip tone="muted">pasif</Chip> : null}
                {c.commission.special ? <Chip tone="carry">ÖZEL</Chip> : null}
              </SheetDescription>
            </div>
            <div className="-mr-2 flex shrink-0 items-center">
              <Button size="icon" variant="ghost" onClick={() => onPrev && void leave(onPrev)} disabled={!onPrev} aria-label="Önceki kişi">
                <ChevronUp />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => onNext && void leave(onNext)} disabled={!onNext} aria-label="Sonraki kişi">
                <ChevronDown />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => void leave(onClose)} aria-label="Kapat">
                <X />
              </Button>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-3 gap-6">
            <Figure label="Hak ediş" value={money(c.gross)} />
            <Figure label="Ödenen" value={money(c.paid_total)} />
            <Figure
              label={c.net_remaining < -0.5 ? (line.employee_status === "left" ? "Borç" : "Fazla ödenen") : "Kalan"}
              value={settled ? "0,00" : money(Math.abs(c.net_remaining))}
              tone={settled ? "text-emerald-700" : c.net_remaining < 0 ? "text-rose-700" : "text-amber-800"}
            />
          </dl>

          <div className="mt-6 flex gap-7 border-b" role="tablist" aria-label="Kişi paneli">
            {(
              [
                ["ozet", "Özet", null],
                ["duzenle", "Düzenle", dirty ? "•" : null],
                ["kayitlar", "Kayıtlar", records ? String(records) : null],
              ] as const
            ).map(([k, label, badge]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 pb-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:text-primary",
                  tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
                {badge ? <span className={cn("text-sm", k === "duzenle" ? "text-amber-600" : "font-normal text-muted-foreground")}>{badge}</span> : null}
              </button>
            ))}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6" role="tabpanel">
          {tab === "ozet" ? (
            <Summary
              line={line}
              c={c}
              draft={draft}
              closed={closed}
              dirty={dirty}
              nextLabel={nextLabel}
              warnings={warnings}
              infos={infos}
              carrying={carry.isPending}
              onEntry={setEntryKind}
              onCarry={async () => {
                if (
                  await confirm({
                    title: `${money(-c.net_remaining)} ₺ ${nextLabel} maaşına devredilsin mi?`,
                    description: `${line.full_name}: bu ay kesilemeyen tutar ${nextLabel} maaşından düşülür ve bu ayın satırı kapanır. İki kayıt birbirine bağlıdır; biri iptal edilirse diğeri de iptal olur.`,
                    confirmLabel: "Devret",
                  })
                )
                  carry.mutate({ id: line.id });
              }}
            />
          ) : tab === "duzenle" ? (
            <EditForm line={line} store={store} period={period} c={c} draft={draft} closed={closed} overtime={overtime} set={set} setDraft={setDraft} onChanged={onChanged} />
          ) : (
            <Records entries={c.entries} closed={closed} nextLabel={nextLabel} onEntry={setEntryKind} onChanged={onChanged} />
          )}
        </div>

        {tab === "duzenle" || dirty ? (
          <footer className="flex shrink-0 items-center gap-3 border-t bg-background px-7 py-4">
            <span className="text-sm text-muted-foreground">{closed ? "Kapalı ay: değişiklik yapılamaz" : dirty ? "Kaydedilmemiş değişiklik var" : "Değişiklik yok"}</span>
            <div className="ml-auto flex gap-2">
              {dirty ? (
                <Button variant="ghost" onClick={() => setDraft(saved)} disabled={update.isPending}>
                  Geri al
                </Button>
              ) : null}
              <Button onClick={() => update.mutate(draftPayload(line, draft))} disabled={!dirty || closed || update.isPending}>
                {update.isPending ? "Kaydediliyor…" : "Kaydet"}
              </Button>
            </div>
          </footer>
        ) : null}

        {entryKind ? (
          <EntryDialog lineId={line.id} employeeId={line.employee_id} fullName={line.full_name} kind={entryKind} onClose={() => setEntryKind(null)} onCreated={onChanged} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 text-2xl font-semibold tabular-nums tracking-tight", tone)}>{value}</dd>
    </div>
  );
}

// ───────────────── Özet ─────────────────

function Summary({
  line,
  c,
  draft,
  closed,
  dirty,
  nextLabel,
  warnings,
  infos,
  carrying,
  onEntry,
  onCarry,
}: {
  line: ComputedLine;
  c: LineCalc;
  draft: LineDraft;
  closed: boolean;
  dirty: boolean;
  nextLabel: string;
  warnings: LineCalc["flags"];
  infos: LineCalc["flags"];
  carrying: boolean;
  onEntry: (k: EntryKind) => void;
  onCarry: () => void;
}) {
  const hours = numOf(draft.overtime_hours);
  const days = numOf(draft.worked_days);
  const ach = c.commission.achievement_used;
  const hasSalary = !line.paid_by_day;

  // Ödeme 2 kalemleri: toplam Ödeme 2'den farklıysa fark tek satırla açıklanır
  // (ödenmeyen maaş bakiyesi eklenir; ek ve kesintinin Ödeme 1'de karşılanan kısmı çıkar).
  const p2: Array<{ label: string; detail?: string; amount: number; tone?: string }> = [];
  if (c.commission.final) p2.push({ label: "Satış primi", detail: [ach != null ? pct(ach) : "", c.commission.overridden ? "elle" : ""].filter(Boolean).join(" · "), amount: c.commission.final });
  if (c.top_seller_amount) p2.push({ label: "Top-seller", amount: c.top_seller_amount });
  if (c.garment_amount) p2.push({ label: "Giysi primi", detail: `${Math.round(numOf(draft.garment_units))} adet`, amount: c.garment_amount });
  if (c.perfume_amount) p2.push({ label: "Parfüm primi", detail: `${Math.round(numOf(draft.perfume_units))} adet`, amount: c.perfume_amount });
  if (c.extra_premium) p2.push({ label: "Ek prim", detail: draft.extra_premium_note || undefined, amount: c.extra_premium });
  if (c.day_pay_amount) p2.push({ label: "Gün ücreti", detail: `${hoursTr(days)} gün`, amount: c.day_pay_amount });
  const otOnly = Math.round((c.overtime_amount - c.day_pay_amount) * 100) / 100;
  if (otOnly) p2.push({ label: "Mesai", detail: `${hoursTr(hours)} saat`, amount: otOnly });
  if (c.additions_total) p2.push({ label: "Eklemeler", amount: c.additions_total, tone: "text-emerald-700" });
  if (c.deductions_from_extras) p2.push({ label: "Kesintiler", amount: -c.deductions_from_extras, tone: "text-rose-700" });
  if (c.carried_forward_total) p2.push({ label: "Sonraki aya devir", detail: nextLabel, amount: c.carried_forward_total, tone: "text-violet-800" });
  if (c.payment2_paid) p2.push({ label: "Ödenen", amount: -c.payment2_paid });
  const diff = Math.round((c.payment2_due - p2.reduce((s, r) => s + r.amount, 0)) * 100) / 100;
  if (Math.abs(diff) > 0.005 && c.net_remaining >= -0.5) p2.push({ label: diff > 0 ? "Ödenmeyen maaş bakiyesi" : "Ödeme 1 ile ödenir", amount: diff, tone: "text-amber-800" });

  return (
    <div className="space-y-7">
      {warnings.length ? (
        <ul className="space-y-1.5 rounded-2xl bg-amber-50 px-5 py-4 text-sm text-amber-950">
          {warnings.map((f, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", f.level === "error" ? "text-rose-600" : "text-amber-600")} />
              {f.text}
            </li>
          ))}
        </ul>
      ) : null}

      <Statement title="Maaş" tag="Ödeme 1" status={!hasSalary ? null : c.base_paid ? <Chip tone="ok">ödendi</Chip> : <Chip tone="wait">bekliyor</Chip>}>
        {hasSalary ? (
          <>
            <Row label="Baz maaş" detail={draft.worked_days.trim() !== "" ? `${hoursTr(days)} gün çalıştı` : undefined} amount={draftBase(line, draft)} plain />
            {c.additions_total ? <Row label="Ek hak ediş" amount={c.additions_total} tone="text-emerald-700" /> : null}
            {c.deductions_from_salary ? <Row label="Kesinti" amount={-c.deductions_from_salary} tone="text-rose-700" /> : null}
            {c.advances_total ? <Row label="Avans" amount={-c.advances_total} /> : null}
            {salaryPaid(c) ? <Row label="Ödenen" amount={-salaryPaid(c)} /> : null}
            <Total label="Kalan maaş" amount={c.payment1_due} done={c.base_paid} />
          </>
        ) : (
          <p className="py-3 text-sm text-muted-foreground">Günle ödenir: maaş yok, çalıştığı günlerin ücreti Ödeme 2’de ödenir.</p>
        )}
      </Statement>

      <Statement title="Prim" tag="Ödeme 2" status={c.payment2_settled ? <Chip tone="ok">ödendi</Chip> : c.payment2_due > 0.5 ? <Chip tone="wait">bekliyor</Chip> : null}>
        {p2.length === 0 ? <p className="py-3 text-sm text-muted-foreground">Bu ay prim kalemi yok.</p> : null}
        {p2.map((r) => (
          <Row key={r.label} label={r.label} detail={r.detail} amount={r.amount} tone={r.tone} />
        ))}
        {p2.length ? <Total label={c.payment2_settled ? "Kalan prim" : "Ödenecek prim"} amount={c.payment2_due} done={c.payment2_settled} /> : null}
      </Statement>

      {c.net_remaining < -0.5 && !closed ? (
        line.employee_status === "left" ? (
          <div className="rounded-2xl bg-rose-50 px-5 py-4 text-sm text-rose-900">
            Ayrıldı; {money(-c.net_remaining)} ₺ fazla ödendi ve borç olarak duruyor. Sonraki aya devredilmez. Para gelince “Ekleme › İade alındı” girin.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-rose-50 px-5 py-4 text-sm text-rose-900">
            <span className="min-w-0 flex-1">
              Bu ay kesilemeyen <b>{money(-c.net_remaining)} ₺</b> var. Ay bu satır sıfırlanmadan kapanmaz.
            </span>
            <Button size="sm" variant="outline" className="bg-background" disabled={carrying || dirty} title={dirty ? "Önce değişiklikleri kaydedin" : undefined} onClick={onCarry}>
              <CornerDownRight className="mr-1.5 h-3.5 w-3.5" />
              {nextLabel} maaşına devret
            </Button>
          </div>
        )
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!closed ? (
          <>
            <Button variant="outline" onClick={() => onEntry("deduction")}>
              <Minus className="mr-1.5 h-4 w-4" />
              Kesinti ekle
            </Button>
            <Button variant="outline" onClick={() => onEntry("addition")}>
              <Plus className="mr-1.5 h-4 w-4" />
              Ekleme ekle
            </Button>
          </>
        ) : null}
        <Button variant="ghost" asChild className="ml-auto text-muted-foreground">
          <a href={`/tr/payroll/payslip/${line.id}`} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-1.5 h-4 w-4" />
            Bordro fişi
          </a>
        </Button>
      </div>

      {infos.length || line.employee_notes ? (
        <div className="space-y-1 border-t pt-5 text-sm text-muted-foreground">
          {infos.map((f, i) => (
            <p key={i}>{f.text}</p>
          ))}
          {line.employee_notes ? <p>{line.employee_notes}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function Statement({ title, tag, status, children }: { title: string; tag: string; status?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2">
        <h3 className="font-semibold tracking-tight">{title}</h3>
        <span className="text-sm text-muted-foreground">{tag}</span>
        <span className="ml-auto">{status}</span>
      </div>
      <dl className="divide-y divide-border/70 rounded-2xl bg-muted/50 px-5 py-1">{children}</dl>
    </section>
  );
}

function Row({ label, detail, amount, tone, plain }: { label: string; detail?: string; amount: number; tone?: string; plain?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 py-3 text-sm">
      <dt className={cn("shrink-0", tone)}>{label}</dt>
      {detail ? <span className="min-w-0 truncate text-muted-foreground">{detail}</span> : null}
      <dd className={cn("ml-auto shrink-0 tabular-nums", tone)}>
        {plain ? "" : amount < 0 ? "− " : "+ "}
        {money(Math.abs(amount))}
      </dd>
    </div>
  );
}

function Total({ label, amount, done }: { label: string; amount: number; done?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 py-3.5">
      <dt className="font-semibold">{label}</dt>
      <dd className={cn("ml-auto text-lg font-semibold tabular-nums", done ? "text-emerald-700" : amount > 0.5 ? "text-amber-800" : "")}>{money(amount)}</dd>
    </div>
  );
}

// ───────────────── Düzenle ─────────────────

function EditForm({
  line,
  store,
  period,
  c,
  draft,
  closed,
  overtime,
  set,
  setDraft,
  onChanged,
}: {
  line: ComputedLine;
  store: StoreBlock;
  period: { year: number; month: number };
  c: LineCalc;
  draft: LineDraft;
  closed: boolean;
  overtime?: Overtime;
  set: <K extends keyof LineDraft>(k: K, v: LineDraft[K]) => void;
  setDraft: (fn: (d: LineDraft) => LineDraft) => void;
  onChanged: () => void;
}) {
  const p = line.commission_profile;
  const isAsistan = p === "mavi_asistan" || p === "deri_asistan";
  const isStoreBased = p === "mavi_mudur" || p === "mavi_vice" || p === "deri_mudur";
  const overtimeOnly = isOvertimeOnlyPosition(line.position) && !draft.extra_premium;
  const hours = numOf(draft.overtime_hours);
  const days = numOf(draft.worked_days);
  const ach = c.commission.achievement_used;
  const advancedSet = [
    !line.paid_by_day && draft.worked_days.trim() !== "" ? `${hoursTr(days)} gün` : "",
    draft.achievement_accepted !== "" ? `ÖZEL %${draft.achievement_accepted}` : "",
    draft.commission_override != null ? "elle prim" : "",
    draft.note || draft.overtime_note || draft.commission_note ? "not var" : "",
  ].filter(Boolean);

  return (
    <div className="divide-y">
      <Group title={line.paid_by_day ? "Çalıştığı gün" : "Mesai"} amount={line.paid_by_day ? c.day_pay_amount : c.overtime_amount - c.day_pay_amount}>
        <div className="flex items-center gap-3 text-sm">
          {line.paid_by_day ? (
            <Input type="number" inputMode="decimal" min={0} max={31} step="1" value={draft.worked_days} onChange={(e) => set("worked_days", e.target.value)} className="h-10 w-28 text-right" placeholder="0" disabled={closed} aria-label="Çalıştığı gün" />
          ) : (
            <Input type="number" inputMode="decimal" min={0} step="0.5" value={draft.overtime_hours} onChange={(e) => set("overtime_hours", e.target.value)} className="h-10 w-28 text-right" placeholder="0" disabled={closed} aria-label="Mesai saati" />
          )}
          <span className="text-muted-foreground">{line.paid_by_day ? `gün × ${money(dayRate(line.card_base_salary))}` : `saat × ${money(c.hourly_rate)}`}</span>
        </div>
        <KolayikHint ot={overtime} line={line} hours={hours} days={draft.worked_days} closed={closed} onHours={(h, note) => setDraft((d) => ({ ...d, overtime_hours: h, overtime_note: note }))} onDays={(v) => set("worked_days", v)} />
      </Group>

      {p !== "none" ? (
        <Group title="Satış primi" amount={c.commission.final}>
          {isAsistan ? (
            <div className={cn("grid gap-4", p === "mavi_asistan" ? "grid-cols-3" : "grid-cols-2")}>
              {p === "mavi_asistan" ? (
                <>
                  <Labeled label="Denim dışı ciro">
                    <MoneyInput value={draft.own_revenue_nd} onChange={(v) => set("own_revenue_nd", v)} className="h-10 text-right" disabled={closed} />
                  </Labeled>
                  <Labeled label="Denim ciro">
                    <MoneyInput value={draft.own_revenue_denim} onChange={(v) => set("own_revenue_denim", v)} className="h-10 text-right" disabled={closed} />
                  </Labeled>
                </>
              ) : (
                <Labeled label="Kendi cirosu">
                  <MoneyInput value={draft.own_revenue} onChange={(v) => set("own_revenue", v)} className="h-10 text-right" disabled={closed} />
                </Labeled>
              )}
              <Labeled label="Kişisel hedef">
                <MoneyInput value={draft.own_target} onChange={(v) => set("own_target", v)} className="h-10 text-right" disabled={closed} />
              </Labeled>
            </div>
          ) : isStoreBased ? (
            <p className="text-sm text-muted-foreground">
              Mağaza cirosu {store.revenue != null ? money(store.revenue) : "girilmedi"}, hedef {store.target != null ? money(store.target) : "girilmedi"}. Mağaza başlığındaki “Ciro ve hedefler”den değişir.
            </p>
          ) : null}
          <p className="mt-3 text-sm text-muted-foreground">
            Başarı <b className={cn("font-semibold", ach == null ? "text-foreground" : ach >= 1 ? "text-emerald-700" : "text-amber-800")}>{ach != null ? pct(ach) : "hedef girilmedi"}</b>
            {c.commission.rate_nd != null
              ? ` · denim dışı %${(c.commission.rate_nd * 100).toLocaleString("tr-TR")}, denim %${((c.commission.rate_denim ?? 0) * 100).toLocaleString("tr-TR")}`
              : c.commission.rate != null
                ? ` · oran %${(c.commission.rate * 100).toLocaleString("tr-TR")}`
                : ""}
          </p>
        </Group>
      ) : null}

      {overtimeOnly ? (
        <Group title="Primler">
          <p className="text-sm text-muted-foreground">Depo personeli: prim yok. Ödeme 2 yalnız mesaidir, kesintiler ondan düşer.</p>
        </Group>
      ) : (
        <Group title="Diğer primler" amount={otherPremiums(c)}>
          <div className="space-y-4">
            {store.is_mavi && p !== "none" ? (
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={draft.top_seller} onChange={(e) => set("top_seller", e.target.checked)} disabled={closed} />
                Ayın en çok satanı
                <span className="text-muted-foreground">top-seller · {money(TOP_SELLER_PREMIUM)}</span>
              </label>
            ) : null}
            {line.garment_eligible || line.garment_units > 0 || line.perfume_eligible || line.perfume_units > 0 ? (
              <div className="grid grid-cols-2 gap-4">
                {line.garment_eligible || line.garment_units > 0 ? (
                  <Labeled label={`Giysi adedi · ${money(GARMENT_PREMIUM_PER_UNIT)} / adet`}>
                    <Input type="number" inputMode="numeric" min={0} value={draft.garment_units} onChange={(e) => set("garment_units", e.target.value)} className="h-10 text-right" placeholder="0" disabled={closed} />
                  </Labeled>
                ) : null}
                {line.perfume_eligible || line.perfume_units > 0 ? (
                  <Labeled label="Parfüm adedi">
                    <Input type="number" inputMode="numeric" min={0} value={draft.perfume_units} onChange={(e) => set("perfume_units", e.target.value)} className="h-10 text-right" placeholder="0" disabled={closed} />
                  </Labeled>
                ) : null}
              </div>
            ) : null}
            <div className="grid grid-cols-[9.5rem_1fr] gap-4">
              <Labeled label="Ek prim">
                <MoneyInput value={draft.extra_premium} onChange={(v) => set("extra_premium", v)} className="h-10 text-right" disabled={closed} />
              </Labeled>
              <Labeled label={draft.extra_premium ? "Sebebi (zorunlu)" : "Sebebi"}>
                <Input value={draft.extra_premium_note} onChange={(e) => set("extra_premium_note", e.target.value)} className={cn("h-10", draft.extra_premium && !draft.extra_premium_note && "border-amber-400")} disabled={closed} />
              </Labeled>
            </div>
          </div>
        </Group>
      )}

      <details className="group py-6">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold tracking-tight [&::-webkit-details-marker]:hidden">
          Gelişmiş
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          <span className="ml-auto text-sm font-normal text-muted-foreground">{advancedSet.length ? advancedSet.join(" · ") : "baz maaş, kısmi ay, ÖZEL başarı, notlar"}</span>
        </summary>
        <div className="mt-5 space-y-5">
          {!line.paid_by_day ? (
            <div className="grid grid-cols-2 gap-4">
              <Labeled label="Baz maaş (bu ay, net)">
                <MoneyInput
                  value={draft.worked_days.trim() !== "" ? dayPaidBase(line.card_base_salary, days) : draft.base_salary}
                  onChange={(v) => set("base_salary", v)}
                  className="h-10 text-right"
                  disabled={closed || draft.worked_days.trim() !== ""}
                />
              </Labeled>
              <Labeled label="Çalıştığı gün (kısmi ay)" help="Boş: tam ay.">
                <Input type="number" inputMode="numeric" min={0} max={31} step="1" value={draft.worked_days} onChange={(e) => set("worked_days", e.target.value)} className="h-10 text-right" disabled={closed} />
              </Labeled>
              <PartialHint line={line} period={period} value={draft.worked_days} closed={closed} onApply={(v) => set("worked_days", v)} />
            </div>
          ) : null}
          {p !== "none" ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Labeled label="Kabul edilen başarı (%)" help="ÖZEL karar: prim bu orandan hesaplanır.">
                  <Input type="number" inputMode="decimal" step="0.1" value={draft.achievement_accepted} onChange={(e) => set("achievement_accepted", e.target.value)} className="h-10 text-right" disabled={closed} />
                </Labeled>
                <Labeled label="Elle satış primi" help="Girilirse tablo yerine bu tutar ödenir.">
                  <MoneyInput value={draft.commission_override} onChange={(v) => set("commission_override", v)} className="h-10 text-right" disabled={closed} />
                </Labeled>
              </div>
              <Labeled label="Satış primi notu" help="Kararı kim, ne zaman verdi.">
                <Input value={draft.commission_note} onChange={(e) => set("commission_note", e.target.value)} className="h-10" disabled={closed} />
              </Labeled>
            </>
          ) : null}
          <Labeled label="Mesai notu">
            <Input value={draft.overtime_note} onChange={(e) => set("overtime_note", e.target.value)} className="h-10" disabled={closed} />
          </Labeled>
          <Labeled label="Not" help="Belirsiz her rakamın nedeni: kim karar verdi, ne zaman.">
            <textarea className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" value={draft.note} onChange={(e) => set("note", e.target.value)} disabled={closed} />
          </Labeled>
          {c.commission.explanation.length && p !== "none" ? (
            <div className="space-y-1 rounded-2xl bg-muted/50 px-5 py-4 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">Prim hesabı</div>
              {c.commission.explanation.map((t, i) => (
                <div key={i}>{t}</div>
              ))}
            </div>
          ) : null}
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="min-w-0 flex-1">{PROFILE_LABEL[p]}</span>
            <StatusToggleButton line={line} closed={closed} onChanged={onChanged} className="h-9 px-3 text-sm" />
          </div>
        </div>
      </details>
    </div>
  );
}

function Group({ title, amount, children }: { title: string; amount?: number; children: ReactNode }) {
  return (
    <section className="py-6 first:pt-0">
      <div className="mb-4 flex items-baseline gap-3">
        <h3 className="font-semibold tracking-tight">{title}</h3>
        {amount != null ? <span className={cn("ml-auto text-lg font-semibold tabular-nums", amount <= 0.005 && "text-muted-foreground")}>{money(amount)}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Labeled({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-muted-foreground">{label}</span>
      {children}
      {help ? <span className="mt-1.5 block text-sm text-muted-foreground">{help}</span> : null}
    </label>
  );
}

/** Kolay İK önerisi: onaylı saat bordrodakinden farklıysa görünür ve tek tıkla yazılır. */
function KolayikHint({
  ot,
  line,
  hours,
  days,
  closed,
  onHours,
  onDays,
}: {
  ot: Overtime | undefined;
  line: ComputedLine;
  hours: number;
  days: string;
  closed: boolean;
  onHours: (hours: string, note: string) => void;
  onDays: (v: string) => void;
}) {
  if (!ot) return null;
  if (line.paid_by_day) {
    const k = ot.full_day_records ?? null;
    if (k == null) return null;
    const same = days.trim() !== "" && Math.abs(numOf(days) - k) < 0.001;
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        Kolay İK: <b className="font-medium text-foreground">{k} gün</b>
        {same ? "· bordroda aynı" : !closed ? <ApplyButton onClick={() => onDays(String(k))} /> : null}
      </div>
    );
  }
  if (!(ot.approved_hours > 0 || ot.waiting_hours > 0 || ot.credit_days > 0)) return null;
  const decision = overtimeApplyDecision(ot, hours);
  const sundayPart = ot.sunday_extra_hours ?? 0;
  const otherPart = Math.round((ot.approved_hours - sundayPart) * 100) / 100;
  const parts = [
    sundayPart > 0 ? (otherPart > 0 ? `pazar üstü ${hoursTr(sundayPart)} s + diğer ${hoursTr(otherPart)} s` : "pazar 8 saat üstü") : "",
    ot.credit_days ? `${ot.credit_days} hak günü` : "",
    ot.short_sunday_records ? `${ot.short_sunday_records} pazarda yalnız ek saat` : "",
    ot.waiting_hours ? `${hoursTr(ot.waiting_hours)} s onay bekliyor` : "",
    ot.review ? "hafta içi 8+ saat kayıt var, elle bakın" : "",
    decision.mode === "wait" ? `onaylanınca ${hoursTr(decision.hours_after_approval)} s olur` : "",
  ].filter(Boolean);
  return (
    <div className="mt-3 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        Kolay İK onaylı: <b className="font-medium text-foreground">{hoursTr(ot.approved_hours)} saat</b>
        {decision.mode === "same" ? "· bordroda aynı" : decision.mode === "apply" && !closed ? <ApplyButton onClick={() => onHours(String(decision.hours), ot.note)} /> : null}
      </div>
      {parts.length ? <div className="mt-0.5">{parts.join(" · ")}</div> : null}
    </div>
  );
}

function ApplyButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="rounded-md border px-2.5 py-0.5 text-sm font-medium text-foreground hover:bg-accent" onClick={onClick}>
      Uygula
    </button>
  );
}

const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** İşe giriş / çıkış bu aydaysa pazarsız gün sayısı önerilir. */
function PartialHint({
  line,
  period,
  value,
  closed,
  onApply,
}: {
  line: ComputedLine;
  period: { year: number; month: number };
  value: string;
  closed: boolean;
  onApply: (v: string) => void;
}) {
  const suggested = workedDaysInPeriod(period.year, period.month, line.start_date, line.end_date);
  const filled = value.trim() !== "";
  if (suggested == null || (filled && Math.abs(numOf(value) - suggested) < 0.001)) {
    return filled ? (
      <p className="col-span-2 text-sm text-muted-foreground">
        Maaş = {hoursTr(numOf(value))} gün × {money(dayRate(line.card_base_salary))} (kart bazı {money(line.card_base_salary)} ÷ 26).
      </p>
    ) : null;
  }
  const first = `${period.year}-${String(period.month).padStart(2, "0")}-01`;
  const why = line.start_date && line.start_date > first ? `İşe giriş ${dm(line.start_date)}` : line.end_date ? `Çıkış ${dm(line.end_date)}` : "";
  return (
    <p className="col-span-2 flex flex-wrap items-center gap-2 text-sm text-sky-900">
      {why}: pazar hariç <b>{suggested} gün</b>.{!closed ? <ApplyButton onClick={() => onApply(String(suggested))} /> : null}
    </p>
  );
}

// ───────────────── Kayıtlar ─────────────────

function Records({
  entries,
  closed,
  nextLabel,
  onEntry,
  onChanged,
}: {
  entries: AnnotatedEntry[];
  closed: boolean;
  nextLabel: string;
  onEntry: (k: EntryKind) => void;
  onChanged: () => void;
}) {
  const [voidId, setVoidId] = useState<string | null>(null);
  const [voidNote, setVoidNote] = useState("");
  const voidEntry = trpc.payroll.entries.void.useMutation({
    onSuccess: () => {
      toast.success("Kayıt iptal edildi");
      setVoidId(null);
      setVoidNote("");
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const adjustments = entries.filter((e) => e.kind === "deduction" || e.kind === "addition");
  const moves = entries.filter((e) => e.kind === "advance" || e.kind === "payment");
  const voided = entries.filter((e) => e.voided_at);

  const item = (e: AnnotatedEntry) => {
    const carried = e.category === CARRY_FORWARD_CATEGORY;
    const tone = e.voided_at ? "text-muted-foreground" : carried ? "text-violet-800" : e.kind === "deduction" ? "text-rose-700" : e.kind === "addition" ? "text-emerald-700" : "";
    const sign = carried ? "→ " : e.kind === "deduction" ? "− " : e.kind === "addition" ? "+ " : "";
    const meta = [dmy(String(e.entry_date)), e.channel ? (CHANNEL_SHORT[e.channel as keyof typeof CHANNEL_SHORT] ?? e.channel) : ""].filter(Boolean).join(" · ");
    return (
      <li key={e.id} className="py-3.5">
        <div className="flex items-start gap-4 text-sm">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className={cn("font-medium", e.voided_at && "text-muted-foreground")}>{carried ? `${nextLabel} maaşına devir` : categoryLabel(e.kind, e.category)}</span>
              <span className="text-muted-foreground">{meta}</span>
            </div>
            {e.note || e.reference ? <p className="mt-1 leading-relaxed text-muted-foreground">{[e.note, e.reference].filter(Boolean).join(" · ")}</p> : null}
            {e.counted_note && !e.voided_at ? <p className="mt-1 text-amber-800">{e.counted_note}: toplama girmiyor.</p> : null}
          </div>
          <div className="shrink-0 text-right">
            <div className={cn("font-semibold tabular-nums", tone, e.voided_at && "line-through")}>
              {sign}
              {money(e.amount)}
            </div>
            {!closed && !e.voided_at && voidId !== e.id ? (
              <button type="button" className="mt-1 text-muted-foreground underline-offset-4 hover:text-rose-700 hover:underline" onClick={() => (setVoidId(e.id), setVoidNote(""))}>
                İptal et
              </button>
            ) : null}
          </div>
        </div>
        {!closed && !e.voided_at && voidId === e.id ? (
          <div className="mt-2.5 space-y-2">
            {e.carry_id ? <p className="text-sm text-violet-800">Bu bir devir kaydı: iptal edilince diğer aydaki karşılığı da iptal edilir.</p> : null}
            <div className="flex items-center gap-2">
              <Input autoFocus placeholder="İptal nedeni" value={voidNote} onChange={(ev) => setVoidNote(ev.target.value)} className="h-9" aria-label="İptal nedeni" />
              <Button size="sm" variant="destructive" onClick={() => voidEntry.mutate({ id: e.id, note: voidNote })} disabled={voidEntry.isPending || voidNote.trim().length < 3}>
                Kaydı iptal et
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setVoidId(null)}>
                Vazgeç
              </Button>
            </div>
          </div>
        ) : null}
      </li>
    );
  };

  const group = (title: string, list: AnnotatedEntry[], empty: string, add: Array<[EntryKind, string]>) => {
    const live = list.filter((e) => !e.voided_at);
    return (
      <section>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold tracking-tight">{title}</h3>
          {!closed ? (
            <span className="ml-auto flex gap-1">
              {add.map(([k, label]) => (
                <Button key={k} size="sm" variant="ghost" onClick={() => onEntry(k)}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {label}
                </Button>
              ))}
            </span>
          ) : null}
        </div>
        {live.length ? <ul className="mt-1 divide-y">{live.map(item)}</ul> : <p className="mt-2 text-sm text-muted-foreground">{empty}</p>}
      </section>
    );
  };

  return (
    <div className="space-y-8">
      {group("Kesinti ve eklemeler", adjustments, "Bu ay kesinti ya da ekleme yok.", [
        ["deduction", "Kesinti"],
        ["addition", "Ekleme"],
      ])}
      {group("Avans ve ödemeler", moves, "Bu ay avans ya da ödeme kaydı yok.", [
        ["advance", "Avans"],
        ["payment", "Ödeme"],
      ])}
      {voided.length ? (
        <details className="border-t pt-4">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">İptal edilen kayıtlar ({voided.length})</summary>
          <ul className="mt-1 divide-y">{voided.map(item)}</ul>
        </details>
      ) : null}
    </div>
  );
}
