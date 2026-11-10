"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronUp, CornerDownRight, ExternalLink, Info, Minus, Plus, X } from "lucide-react";
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
import { categoryLabel, Chip, LABEL, salaryPaid } from "./parts";

type Overtime = KolayikMonth["overtime"][number];

/**
 * KİŞİ PANELİ — bir kişinin o ayki her şeyi tek yerde, sağdan açılır.
 *
 * Eski düzende aynı kişi üç ayrı yerde düzenleniyordu (genel tablo, prim
 * tablosu, beş sütunlu pencere). Burada sıra ödeme sırasıdır: Maaş (Ödeme 1)
 * → Prim (Ödeme 2) → kesinti ve eklemeler → ödeme kayıtları. Nadiren
 * dokunulan alanlar (kısmi ay, ÖZEL başarı, elle prim, notlar) "Diğer
 * ayarlar" altındadır. Hesap yazarken sunucudaki motorla yapılır.
 */
export function PersonSheet({
  line,
  store,
  period,
  closed,
  nextLabel,
  overtime,
  onPrev,
  onNext,
  onClose,
  onChanged,
}: {
  line: ComputedLine;
  store: StoreBlock;
  period: { year: number; month: number };
  closed: boolean;
  /** "Kasım 2026" — sonraki aya devir metinleri için */
  nextLabel: string;
  overtime?: Overtime;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
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

  const p = line.commission_profile;
  const isAsistan = p === "mavi_asistan" || p === "deri_asistan";
  const isStoreBased = p === "mavi_mudur" || p === "mavi_vice" || p === "deri_mudur";
  const overtimeOnly = isOvertimeOnlyPosition(line.position) && !draft.extra_premium;
  const hours = numOf(draft.overtime_hours);
  const days = numOf(draft.worked_days);
  const settled = Math.abs(c.net_remaining) <= 0.5;
  const adjustments = c.entries.filter((e) => e.kind === "deduction" || e.kind === "addition");
  const money_moves = c.entries.filter((e) => e.kind === "advance" || e.kind === "payment");
  const hasAdvanced =
    draft.achievement_accepted !== "" || draft.commission_override != null || (!line.paid_by_day && draft.worked_days !== "") || !!draft.note || !!draft.overtime_note;

  return (
    <Sheet open onOpenChange={(o) => !o && void leave(onClose)}>
      <SheetContent>
        {/* Başlık */}
        <header className="shrink-0 border-b px-6 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
                {line.full_name}
                {line.employee_status === "left" ? <Chip tone="muted">ayrıldı</Chip> : line.employee_status === "inactive" ? <Chip tone="muted">pasif</Chip> : null}
                {c.commission.special ? <Chip tone="carry">ÖZEL</Chip> : null}
              </SheetTitle>
              <SheetDescription className="mt-1 text-sm text-muted-foreground">
                {line.position} · {line.store_name} · {PAY_METHOD_SHORT[line.pay_method]}
              </SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
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
          <dl className="mt-4 grid grid-cols-3 divide-x rounded-xl border bg-muted/30">
            <Figure label="Hak ediş" value={money(c.gross)} />
            <Figure label="Ödenen" value={money(c.paid_total)} />
            <Figure
              label={c.net_remaining < -0.5 ? (line.employee_status === "left" ? "Borç" : "Fazla ödenen") : "Kalan"}
              value={settled ? "0,00" : money(Math.abs(c.net_remaining))}
              tone={settled ? "text-emerald-700" : c.net_remaining < 0 ? "text-rose-700" : "text-amber-800"}
              note={settled ? "kapandı" : undefined}
            />
          </dl>
        </header>

        {/* Gövde */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {c.flags.length ? (
            <ul className="space-y-1.5 text-sm">
              {c.flags.map((f, i) => (
                <li key={i} className={cn("flex items-start gap-2", f.level === "error" ? "text-rose-700" : f.level === "warn" ? "text-amber-900" : "text-muted-foreground")}>
                  {f.level === "info" ? <Info className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                  {f.text}
                </li>
              ))}
            </ul>
          ) : null}

          {/* 1 — Maaş */}
          <Section title="Maaş — Ödeme 1" aside={line.base_salary > 0 || c.payment1_due > 0.5 ? (c.base_paid ? <Chip tone="ok">ödendi</Chip> : <Chip tone="wait">bekliyor</Chip>) : null}>
            {line.paid_by_day ? (
              <p className="text-sm text-muted-foreground">Günle ödenir: maaş yok, çalıştığı günlerin ücreti Ödeme 2&apos;de ödenir.</p>
            ) : (
              <Ledger>
                <LedgerRow
                  label="Baz maaş"
                  hint={draft.worked_days.trim() !== "" ? `${hoursTr(days)} gün × ${money(dayRate(line.card_base_salary))}` : undefined}
                  amount={draftBase(line, draft)}
                />
                {c.additions_total ? <LedgerRow label="Ek hak ediş" amount={c.additions_total} sign="+" tone="text-emerald-700" /> : null}
                {c.deductions_from_salary ? <LedgerRow label="Kesinti (maaştan)" amount={c.deductions_from_salary} sign="−" tone="text-rose-700" /> : null}
                {c.advances_total ? <LedgerRow label="Avans" amount={c.advances_total} sign="−" /> : null}
                {salaryPaid(c) ? <LedgerRow label="Ödenen maaş" amount={salaryPaid(c)} sign="−" /> : null}
                <LedgerRow label="Kalan maaş" amount={c.payment1_due} total />
              </Ledger>
            )}
            {line.paid_month_early ? <p className="mt-2 text-sm text-muted-foreground">Maaşı bir ay önceden ödenir; bu ayın talimatına girmez.</p> : null}
          </Section>

          {/* 2 — Prim */}
          <Section
            title="Prim — Ödeme 2"
            aside={c.payment2_settled ? <Chip tone="ok">ödendi</Chip> : c.payment2_due > 0.5 ? <Chip tone="wait">bekliyor</Chip> : null}
          >
            <div className="space-y-4">
              {/* Mesai / gün */}
              <Field label={line.paid_by_day ? "Çalıştığı gün" : "Mesai"}>
                {line.paid_by_day ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Input type="number" inputMode="decimal" min={0} max={31} step="1" value={draft.worked_days} onChange={(e) => set("worked_days", e.target.value)} className="h-9 w-24 text-right" placeholder="0" disabled={closed} aria-label="Çalıştığı gün" />
                    <span className="text-muted-foreground">gün × {money(dayRate(line.card_base_salary))}</span>
                    <span className="ml-auto font-semibold tabular-nums">{money(c.day_pay_amount)}</span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Input type="number" inputMode="decimal" min={0} step="0.5" value={draft.overtime_hours} onChange={(e) => set("overtime_hours", e.target.value)} className="h-9 w-24 text-right" placeholder="0" disabled={closed} aria-label="Mesai saati" />
                    <span className="text-muted-foreground">saat × {money(c.hourly_rate)}</span>
                    <span className="ml-auto font-semibold tabular-nums">{money(c.overtime_amount - c.day_pay_amount)}</span>
                  </div>
                )}
                <KolayikHint ot={overtime} line={line} hours={hours} days={draft.worked_days} closed={closed} onHours={(h, note) => setDraft((d) => ({ ...d, overtime_hours: h, overtime_note: note }))} onDays={(v) => set("worked_days", v)} />
              </Field>

              {/* Satış primi */}
              {p !== "none" ? (
                <Field label="Satış primi">
                  {isAsistan ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {p === "mavi_asistan" ? (
                        <>
                          <Labeled label="Denim dışı ciro">
                            <MoneyInput value={draft.own_revenue_nd} onChange={(v) => set("own_revenue_nd", v)} className="h-9 text-right" disabled={closed} />
                          </Labeled>
                          <Labeled label="Denim ciro">
                            <MoneyInput value={draft.own_revenue_denim} onChange={(v) => set("own_revenue_denim", v)} className="h-9 text-right" disabled={closed} />
                          </Labeled>
                        </>
                      ) : (
                        <Labeled label="Kendi cirosu (KDV hariç)">
                          <MoneyInput value={draft.own_revenue} onChange={(v) => set("own_revenue", v)} className="h-9 text-right" disabled={closed} />
                        </Labeled>
                      )}
                      <Labeled label="Kişisel hedef">
                        <MoneyInput value={draft.own_target} onChange={(v) => set("own_target", v)} className="h-9 text-right" disabled={closed} />
                      </Labeled>
                    </div>
                  ) : isStoreBased ? (
                    <p className="text-sm text-muted-foreground">
                      Mağaza cirosu <b className="font-medium text-foreground">{store.revenue != null ? money(store.revenue) : "—"}</b> · hedef{" "}
                      <b className="font-medium text-foreground">{store.target != null ? money(store.target) : "—"}</b>. Mağaza başlığındaki “Ciro ve hedefler”den değişir.
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="text-muted-foreground">
                      başarı{" "}
                      <b className={cn("font-semibold", c.commission.achievement_used == null ? "" : c.commission.achievement_used >= 1 ? "text-emerald-700" : "text-amber-800")}>
                        {c.commission.achievement_used != null ? pct(c.commission.achievement_used) : "hedef girilmedi"}
                      </b>
                      {c.commission.rate_nd != null
                        ? ` · denim dışı %${(c.commission.rate_nd * 100).toLocaleString("tr-TR")} / denim %${((c.commission.rate_denim ?? 0) * 100).toLocaleString("tr-TR")}`
                        : c.commission.rate != null
                          ? ` · oran %${(c.commission.rate * 100).toLocaleString("tr-TR")}`
                          : ""}
                      {c.commission.overridden ? " · elle girildi" : ""}
                    </span>
                    <span className="ml-auto font-semibold tabular-nums">{money(c.commission.final)}</span>
                  </div>
                </Field>
              ) : null}

              {/* Diğer primler */}
              {overtimeOnly ? (
                <p className="text-sm text-muted-foreground">Depo personeli: prim yok. Ödeme 2 yalnız mesaidir, kesintiler ondan düşer.</p>
              ) : (
                <Field label="Diğer primler">
                  <div className="space-y-2.5">
                    {store.is_mavi && p !== "none" ? (
                      <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                        <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={draft.top_seller} onChange={(e) => set("top_seller", e.target.checked)} disabled={closed} />
                        Ayın en çok satanı (top-seller)
                        <span className="ml-auto font-semibold tabular-nums">{draft.top_seller ? money(TOP_SELLER_PREMIUM) : <span className="font-normal text-muted-foreground">{money(TOP_SELLER_PREMIUM)}</span>}</span>
                      </label>
                    ) : null}
                    {line.garment_eligible || line.garment_units > 0 ? (
                      <div className="flex items-center gap-2 text-sm">
                        <span>Giysi primi</span>
                        <Input type="number" inputMode="numeric" min={0} value={draft.garment_units} onChange={(e) => set("garment_units", e.target.value)} className="h-9 w-20 text-right" placeholder="0" disabled={closed} aria-label="Giysi adedi" />
                        <span className="text-muted-foreground">adet × {money(GARMENT_PREMIUM_PER_UNIT)} · outlet ceket sayılmaz</span>
                        <span className="ml-auto font-semibold tabular-nums">{money(c.garment_amount)}</span>
                      </div>
                    ) : null}
                    {line.perfume_eligible || line.perfume_units > 0 ? (
                      <div className="flex items-center gap-2 text-sm">
                        <span>Parfüm primi</span>
                        <Input type="number" inputMode="numeric" min={0} value={draft.perfume_units} onChange={(e) => set("perfume_units", e.target.value)} className="h-9 w-20 text-right" placeholder="0" disabled={closed} aria-label="Parfüm adedi" />
                        <span className="text-muted-foreground">adet</span>
                        <span className="ml-auto font-semibold tabular-nums">{money(c.perfume_amount)}</span>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span>Ek prim</span>
                      <MoneyInput value={draft.extra_premium} onChange={(v) => set("extra_premium", v)} placeholder="0,00" className="h-9 w-32 text-right" disabled={closed} aria-label="Ek prim tutarı" />
                      <Input
                        value={draft.extra_premium_note}
                        onChange={(e) => set("extra_premium_note", e.target.value)}
                        placeholder={draft.extra_premium ? "Sebebi (zorunlu)" : "Sebebi"}
                        className={cn("h-9 min-w-[10rem] flex-1", draft.extra_premium && !draft.extra_premium_note && "border-amber-400")}
                        disabled={closed}
                        aria-label="Ek prim sebebi"
                      />
                    </div>
                  </div>
                </Field>
              )}

              <Payment2Ledger c={c} hours={hours} days={days} nextLabel={nextLabel} />
            </div>
          </Section>

          {/* 3 — Kesinti ve eklemeler */}
          <Section
            title="Kesinti ve eklemeler"
            aside={
              !closed ? (
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEntryKind("deduction")}>
                    <Minus className="mr-1 h-3.5 w-3.5" />
                    Kesinti
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEntryKind("addition")}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Ekleme
                  </Button>
                </span>
              ) : null
            }
          >
            <EntryList entries={adjustments} closed={closed} empty="Bu ay kesinti ya da ekleme yok." nextLabel={nextLabel} onChanged={onChanged} />
            {c.net_remaining < -0.5 && !closed ? (
              line.employee_status === "left" ? (
                <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
                  Ayrıldı; {money(-c.net_remaining)} ₺ fazla ödendi ve borç olarak duruyor. Sonraki aya devredilmez. Para gelince “Ekleme › İade alındı” girin.
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
                  <span className="min-w-0 flex-1">
                    Bu ay kesilemeyen <b>{money(-c.net_remaining)} ₺</b> var. Ay bu satır sıfırlanmadan kapanmaz.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-background"
                    disabled={carry.isPending || dirty}
                    title={dirty ? "Önce değişiklikleri kaydedin" : undefined}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `${money(-c.net_remaining)} ₺ ${nextLabel} maaşına devredilsin mi?`,
                          description: `${line.full_name}: bu ay kesilemeyen tutar ${nextLabel} maaşından düşülür ve bu ayın satırı kapanır. İki kayıt birbirine bağlıdır; biri iptal edilirse diğeri de iptal olur.`,
                          confirmLabel: "Devret",
                        })
                      )
                        carry.mutate({ id: line.id });
                    }}
                  >
                    <CornerDownRight className="mr-1.5 h-3.5 w-3.5" />
                    {nextLabel} maaşına devret
                  </Button>
                </div>
              )
            ) : null}
          </Section>

          {/* 4 — Avans ve ödemeler */}
          <Section
            title="Avans ve ödemeler"
            aside={
              !closed ? (
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEntryKind("advance")}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Avans
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEntryKind("payment")}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Ödeme
                  </Button>
                </span>
              ) : null
            }
          >
            <EntryList entries={money_moves} closed={closed} empty="Bu ay avans ya da ödeme kaydı yok." nextLabel={nextLabel} onChanged={onChanged} />
          </Section>

          {/* 5 — Diğer ayarlar */}
          <details open={hasAdvanced} className="group rounded-xl border">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium hover:bg-accent/50 [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              Diğer ayarlar
              <span className="ml-auto text-sm font-normal text-muted-foreground">baz maaş · kısmi ay · ÖZEL başarı · notlar</span>
            </summary>
            <div className="space-y-4 border-t px-4 py-4">
              {!line.paid_by_day ? (
                <div className="grid grid-cols-2 gap-3">
                  <Labeled label="Bu ayın baz maaşı (net)">
                    <MoneyInput
                      value={draft.worked_days.trim() !== "" ? dayPaidBase(line.card_base_salary, days) : draft.base_salary}
                      onChange={(v) => set("base_salary", v)}
                      className="h-9 text-right"
                      disabled={closed || draft.worked_days.trim() !== ""}
                    />
                  </Labeled>
                  <Labeled label="Kısmi ay: çalıştığı gün">
                    <Input type="number" inputMode="numeric" min={0} max={31} step="1" value={draft.worked_days} onChange={(e) => set("worked_days", e.target.value)} className="h-9 text-right" placeholder="tam ay" disabled={closed} />
                  </Labeled>
                  <PartialHint line={line} period={period} value={draft.worked_days} closed={closed} onApply={(v) => set("worked_days", v)} />
                </div>
              ) : null}
              {p !== "none" ? (
                <div className="grid grid-cols-2 gap-3">
                  <Labeled label="ÖZEL: kabul edilen başarı (%)">
                    <Input type="number" inputMode="decimal" step="0.1" placeholder="örn. 100" value={draft.achievement_accepted} onChange={(e) => set("achievement_accepted", e.target.value)} className="h-9 text-right" disabled={closed} />
                  </Labeled>
                  <Labeled label="Satış primi elle (tabloyu geçersiz kılar)">
                    <MoneyInput value={draft.commission_override} onChange={(v) => set("commission_override", v)} placeholder="boş: tablodan" className="h-9 text-right" disabled={closed} />
                  </Labeled>
                  <div className="col-span-2">
                    <Labeled label="Satış primi notu (karar: kim, ne zaman)">
                      <Input value={draft.commission_note} onChange={(e) => set("commission_note", e.target.value)} className="h-9" placeholder="örn. %99,7 → %100 kabul (Alp 07.10)" disabled={closed} />
                    </Labeled>
                  </div>
                  {c.commission.explanation.length ? (
                    <div className="col-span-2 space-y-0.5 rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      {c.commission.explanation.map((t, i) => (
                        <div key={i}>{t}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <Labeled label="Mesai notu (onaylı kayıt, günler)">
                <Input value={draft.overtime_note} onChange={(e) => set("overtime_note", e.target.value)} className="h-9" disabled={closed} />
              </Labeled>
              <Labeled label="Not (denetim izi)">
                <textarea
                  className="min-h-[72px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={draft.note}
                  onChange={(e) => set("note", e.target.value)}
                  placeholder="Belirsiz her rakamın nedeni, kim karar verdi, ne zaman"
                  disabled={closed}
                />
              </Labeled>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>{PROFILE_LABEL[p]}</span>
                {line.employee_notes ? <span>· {line.employee_notes}</span> : null}
                <StatusToggleButton line={line} closed={closed} onChanged={onChanged} className="ml-auto" />
              </div>
            </div>
          </details>
        </div>

        {/* Alt çubuk */}
        <footer className="flex shrink-0 items-center gap-3 border-t bg-background px-6 py-3.5">
          <Button variant="ghost" size="sm" asChild>
            <a href={`/tr/payroll/payslip/${line.id}`} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Bordro fişi
            </a>
          </Button>
          <span className="ml-auto text-sm text-muted-foreground">{closed ? "Kapalı ay: değişiklik yapılamaz" : dirty ? "Kaydedilmemiş değişiklik" : ""}</span>
          {dirty ? (
            <Button variant="outline" onClick={() => setDraft(saved)} disabled={update.isPending}>
              Geri al
            </Button>
          ) : null}
          <Button onClick={() => update.mutate(draftPayload(line, draft))} disabled={!dirty || closed || update.isPending}>
            {update.isPending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </footer>

        {entryKind ? (
          <EntryDialog lineId={line.id} employeeId={line.employee_id} fullName={line.full_name} kind={entryKind} onClose={() => setEntryKind(null)} onCreated={onChanged} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// ───────────────── Parçalar ─────────────────

function Figure({ label, value, tone, note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div className="px-4 py-3">
      <dt className={LABEL}>{label}</dt>
      <dd className={cn("mt-0.5 text-lg font-semibold tabular-nums tracking-tight", tone)}>
        {value}
        {note ? <span className="ml-1.5 text-sm font-medium">{note}</span> : null}
      </dd>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex min-h-8 items-center gap-3">
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        <div className="ml-auto">{aside}</div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border px-4 py-3">
      <div className={cn(LABEL, "mb-2")}>{label}</div>
      {children}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Ledger({ children }: { children: ReactNode }) {
  return <dl className="rounded-xl border px-4 py-1.5 text-sm">{children}</dl>;
}

function LedgerRow({
  label,
  hint,
  amount,
  sign,
  tone,
  total,
}: {
  label: string;
  hint?: string;
  amount: number;
  sign?: "+" | "−";
  tone?: string;
  total?: boolean;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1.5", total && "mt-1 border-t pt-2.5 font-semibold")}>
      <dt className={cn(!total && "text-muted-foreground", tone)}>
        {label}
        {hint ? <span className="ml-2 text-muted-foreground">{hint}</span> : null}
      </dt>
      <dd className={cn("shrink-0 tabular-nums", total && "text-base", tone)}>
        {sign ? `${sign} ` : ""}
        {money(Math.abs(amount))}
      </dd>
    </div>
  );
}

/**
 * Ödeme 2 dökümü: kalemler alt alta, en altta kişiye ödenecek tutar. Kalemlerin
 * toplamı Ödeme 2'den farklıysa fark tek satırla açıklanır (ödenmeyen maaş
 * bakiyesi Ödeme 2'ye eklenir; ek ve kesintinin Ödeme 1'de karşılanan kısmı
 * Ödeme 2'den çıkar — compute.ts).
 */
function Payment2Ledger({ c, hours, days, nextLabel }: { c: LineCalc; hours: number; days: number; nextLabel: string }) {
  const rows: Array<{ label: string; amount: number; tone?: string }> = [];
  if (c.commission.final) rows.push({ label: "Satış primi", amount: c.commission.final });
  if (c.top_seller_amount) rows.push({ label: "Top-seller", amount: c.top_seller_amount });
  if (c.garment_amount) rows.push({ label: "Giysi primi", amount: c.garment_amount });
  if (c.perfume_amount) rows.push({ label: "Parfüm primi", amount: c.perfume_amount });
  if (c.extra_premium) rows.push({ label: "Ek prim", amount: c.extra_premium });
  if (c.day_pay_amount) rows.push({ label: `Gün ücreti (${hoursTr(days)} gün)`, amount: c.day_pay_amount });
  const otOnly = Math.round((c.overtime_amount - c.day_pay_amount) * 100) / 100;
  if (otOnly) rows.push({ label: `Mesai (${hoursTr(hours)} saat)`, amount: otOnly });
  if (c.additions_total) rows.push({ label: "Eklemeler", amount: c.additions_total, tone: "text-emerald-700" });
  if (c.deductions_from_extras) rows.push({ label: "Kesintiler", amount: -c.deductions_from_extras, tone: "text-rose-700" });
  if (c.carried_forward_total) rows.push({ label: `${nextLabel} maaşına devir`, amount: c.carried_forward_total, tone: "text-violet-800" });
  if (c.payment2_paid) rows.push({ label: "Ödenen (Ödeme 2)", amount: -c.payment2_paid });
  const listed = rows.reduce((s, r) => s + r.amount, 0);
  const diff = Math.round((c.payment2_due - listed) * 100) / 100;
  if (Math.abs(diff) > 0.005 && c.net_remaining >= -0.5)
    rows.push({ label: diff > 0 ? "Ödenmeyen maaş bakiyesi" : "Ödeme 1 ile ödenir", amount: diff, tone: "text-amber-800" });
  return (
    <Ledger>
      {rows.length === 0 ? <div className="py-1.5 text-muted-foreground">Henüz kalem yok.</div> : null}
      {rows.map((r) => (
        <LedgerRow key={r.label} label={r.label} amount={r.amount} sign={r.amount < 0 ? "−" : "+"} tone={r.tone} />
      ))}
      <LedgerRow label={c.payment2_settled ? "Kalan (Ödeme 2)" : "Ödenecek (Ödeme 2)"} amount={c.payment2_due} total />
    </Ledger>
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
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
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
    <div className="mt-2 text-sm text-muted-foreground">
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
    <button type="button" className="rounded-md border px-2 py-0.5 text-sm font-medium text-foreground hover:bg-accent" onClick={onClick}>
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
        Maaş = {hoursTr(numOf(value))} gün × {money(dayRate(line.card_base_salary))} (kart bazı {money(line.card_base_salary)} ÷ 26). Günü silince tam ay olur.
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

/** Kayıt listesi: geçerli kayıtlar üstte, iptal edilenler ayrı açılır başlık altında. */
function EntryList({
  entries,
  closed,
  empty,
  nextLabel,
  onChanged,
}: {
  entries: AnnotatedEntry[];
  closed: boolean;
  empty: string;
  nextLabel: string;
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
  const live = entries.filter((e) => !e.voided_at);
  const voided = entries.filter((e) => e.voided_at);

  const item = (e: AnnotatedEntry) => {
    const carried = e.category === CARRY_FORWARD_CATEGORY;
    const tone = e.voided_at
      ? "text-muted-foreground"
      : carried
        ? "text-violet-800"
        : e.kind === "deduction"
          ? "text-rose-700"
          : e.kind === "addition"
            ? "text-emerald-700"
            : "";
    const sign = carried ? "→" : e.kind === "deduction" ? "−" : e.kind === "addition" ? "+" : "";
    return (
      <li key={e.id} className="px-4 py-2.5 text-sm">
        <div className="flex items-baseline gap-3">
          <div className="min-w-0 flex-1">
            <span className={cn("font-medium", tone)}>{carried ? `${nextLabel} maaşına devredildi` : categoryLabel(e.kind, e.category)}</span>
            <span className="ml-2 text-muted-foreground">
              {dmy(String(e.entry_date))}
              {e.channel ? ` · ${CHANNEL_SHORT[e.channel as keyof typeof CHANNEL_SHORT] ?? e.channel}` : ""}
            </span>
          </div>
          <span className={cn("shrink-0 font-semibold tabular-nums", tone, e.voided_at && "line-through")}>
            {sign ? `${sign} ` : ""}
            {money(e.amount)}
          </span>
          {!closed && !e.voided_at ? (
            <button type="button" className="shrink-0 text-sm text-muted-foreground underline-offset-2 hover:text-rose-700 hover:underline" onClick={() => setVoidId(voidId === e.id ? null : e.id)}>
              İptal et
            </button>
          ) : null}
        </div>
        {e.note || e.reference ? <div className="mt-0.5 text-sm text-muted-foreground">{[e.note, e.reference].filter(Boolean).join(" · ")}</div> : null}
        {e.counted_note && !e.voided_at ? <div className="mt-0.5 text-sm text-amber-800">{e.counted_note}: toplama girmiyor.</div> : null}
        {voidId === e.id ? (
          <div className="mt-2 space-y-2">
            {e.carry_id ? <div className="text-sm text-violet-800">Bu bir devir kaydı: iptal edilince diğer aydaki karşılığı da iptal edilir.</div> : null}
            <div className="flex items-center gap-2">
              <Input autoFocus placeholder="İptal nedeni (zorunlu)" value={voidNote} onChange={(ev) => setVoidNote(ev.target.value)} className="h-9" aria-label="İptal nedeni" />
              <Button size="sm" variant="destructive" onClick={() => voidEntry.mutate({ id: e.id, note: voidNote })} disabled={voidEntry.isPending || voidNote.trim().length < 3}>
                İptal et
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

  return (
    <div className="overflow-hidden rounded-xl border">
      {live.length ? <ul className="divide-y">{live.map(item)}</ul> : <div className="px-4 py-3 text-sm text-muted-foreground">{empty}</div>}
      {voided.length ? (
        <details className="border-t">
          <summary className="cursor-pointer px-4 py-2 text-sm text-muted-foreground hover:text-foreground">İptal edilen kayıtlar ({voided.length})</summary>
          <ul className="divide-y border-t">{voided.map(item)}</ul>
        </details>
      ) : null}
    </div>
  );
}
