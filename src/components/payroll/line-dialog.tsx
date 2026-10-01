"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Info, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ComputedLine, StoreBlock } from "@/server/services/payroll/period";
import { PAY_METHOD_LABEL, PROFILE_LABEL } from "@/server/services/payroll/rules";
import { KIND_LABEL, KIND_TONE, dmy, money, pct, rate } from "./format";
import { EntryDialog, type EntryKind } from "./entry-dialog";

type Form = {
  base_salary: number | undefined;
  overtime_hours: string;
  overtime_note: string;
  own_revenue_nd: number | undefined;
  own_revenue_denim: number | undefined;
  own_revenue: number | undefined;
  own_target: number | undefined;
  achievement_accepted: string; // yüzde metni: "100"
  commission_override: number | undefined;
  commission_note: string;
  perfume_units: string;
  garment_units: string;
  top_seller: boolean;
  extra_premium: number | undefined;
  extra_premium_note: string;
  note: string;
};

function fromLine(l: ComputedLine): Form {
  return {
    base_salary: l.base_salary,
    overtime_hours: l.overtime_hours ? String(l.overtime_hours) : "",
    overtime_note: l.overtime_note ?? "",
    own_revenue_nd: l.own_revenue_nd ?? undefined,
    own_revenue_denim: l.own_revenue_denim ?? undefined,
    own_revenue: l.own_revenue ?? undefined,
    own_target: l.own_target ?? undefined,
    achievement_accepted: l.achievement_accepted != null ? String(Math.round(l.achievement_accepted * 10000) / 100) : "",
    commission_override: l.commission_override ?? undefined,
    commission_note: l.commission_note ?? "",
    perfume_units: l.perfume_units ? String(l.perfume_units) : "",
    garment_units: l.garment_units ? String(l.garment_units) : "",
    top_seller: l.top_seller,
    extra_premium: l.extra_premium || undefined,
    extra_premium_note: l.extra_premium_note ?? "",
    note: l.note ?? "",
  };
}

export function LineDialog({
  line,
  store,
  periodStatus,
  onClose,
  onChanged,
}: {
  line: ComputedLine;
  store: StoreBlock;
  periodStatus: "open" | "closed";
  onClose: () => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<Form>(() => fromLine(line));
  const [entryKind, setEntryKind] = useState<EntryKind | null>(null);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [voidNote, setVoidNote] = useState("");
  useEffect(() => setForm(fromLine(line)), [line]);

  const closed = periodStatus === "closed";
  const c = line.calc;
  const p = line.commission_profile;
  const isMaviAsistan = p === "mavi_asistan";
  const isDeriAsistan = p === "deri_asistan";
  const isStoreBased = p === "mavi_mudur" || p === "mavi_vice" || p === "deri_mudur";

  const update = trpc.payroll.lines.update.useMutation({
    onSuccess: () => {
      toast.success("Kaydedildi");
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const voidEntry = trpc.payroll.entries.void.useMutation({
    onSuccess: () => {
      toast.success("Kayıt iptal edildi");
      setVoidId(null);
      setVoidNote("");
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  const num = (s: string) => (s.trim() === "" ? 0 : Number(s.replace(",", ".")));
  const save = () => {
    const accepted = form.achievement_accepted.trim();
    update.mutate({
      id: line.id,
      base_salary: form.base_salary ?? 0,
      overtime_hours: num(form.overtime_hours),
      overtime_note: form.overtime_note,
      own_revenue_nd: isMaviAsistan ? (form.own_revenue_nd ?? null) : undefined,
      own_revenue_denim: isMaviAsistan ? (form.own_revenue_denim ?? null) : undefined,
      own_revenue: isDeriAsistan ? (form.own_revenue ?? null) : undefined,
      own_target: isMaviAsistan || isDeriAsistan ? (form.own_target ?? null) : undefined,
      achievement_accepted: accepted === "" ? null : Number(accepted.replace(",", ".")) / 100,
      commission_override: form.commission_override ?? null,
      commission_note: form.commission_note,
      perfume_units: Math.round(num(form.perfume_units)),
      garment_units: Math.round(num(form.garment_units)),
      top_seller: form.top_seller,
      extra_premium: form.extra_premium ?? 0,
      extra_premium_note: form.extra_premium_note,
      note: form.note,
    });
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {line.full_name}
            <span className="text-sm font-normal text-muted-foreground">
              {line.position} · {line.store_name} · {PAY_METHOD_LABEL[line.pay_method]}
            </span>
          </DialogTitle>
          <DialogDescription>{PROFILE_LABEL[p]}{line.employee_notes ? ` · ${line.employee_notes}` : ""}</DialogDescription>
        </DialogHeader>

        {c.flags.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {c.flags.map((f, i) => (
              <li key={i} className={cn("flex items-start gap-2", f.level === "error" ? "text-rose-700" : f.level === "warn" ? "text-amber-800" : "text-muted-foreground")}>
                {f.level === "info" ? <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                {f.text}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          {/* Girdiler */}
          <div className="space-y-4">
            <Section title="Maaş ve mesai">
              <Field label="Baz maaş (NET)">
                <MoneyInput value={form.base_salary} onChange={(v) => set("base_salary", v)} disabled={closed} />
              </Field>
              <Field label={`Mesai saati (saatlik ${money(c.hourly_rate)} ₺)`}>
                <Input type="number" inputMode="decimal" step="0.5" min={0} value={form.overtime_hours} onChange={(e) => set("overtime_hours", e.target.value)} disabled={closed} />
              </Field>
              <Field label="Mesai notu (onaylı log, günler)" wide>
                <Input value={form.overtime_note} onChange={(e) => set("overtime_note", e.target.value)} disabled={closed} placeholder="örn. 03–08.08 (6 gün) 3s açılış-kapanış" />
              </Field>
            </Section>

            {p !== "none" ? (
              <Section title="Komisyon">
                {isMaviAsistan ? (
                  <>
                    <Field label="Kendi cirosu — denim dışı (ND)">
                      <MoneyInput value={form.own_revenue_nd} onChange={(v) => set("own_revenue_nd", v)} disabled={closed} />
                    </Field>
                    <Field label="Kendi cirosu — denim">
                      <MoneyInput value={form.own_revenue_denim} onChange={(v) => set("own_revenue_denim", v)} disabled={closed} />
                    </Field>
                    <Field label="Kişisel hedef">
                      <MoneyInput value={form.own_target} onChange={(v) => set("own_target", v)} disabled={closed} />
                    </Field>
                  </>
                ) : null}
                {isDeriAsistan ? (
                  <>
                    <Field label="Kendi cirosu (KDV hariç)">
                      <MoneyInput value={form.own_revenue} onChange={(v) => set("own_revenue", v)} disabled={closed} />
                    </Field>
                    <Field label="Kişisel hedef">
                      <MoneyInput value={form.own_target} onChange={(v) => set("own_target", v)} disabled={closed} />
                    </Field>
                  </>
                ) : null}
                {isStoreBased ? (
                  <div className="col-span-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                    Mağaza cirosu <b>{store.revenue != null ? money(store.revenue) : "—"}</b> · hedef{" "}
                    <b>{store.target != null ? money(store.target) : "—"}</b>
                    {store.achievement != null ? <> · başarı <b>{pct(store.achievement)}</b></> : null}
                    <div className="text-xs text-muted-foreground">Mağaza başlığından düzenlenir.</div>
                  </div>
                ) : null}
                <Field label="ÖZEL — kabul edilen başarı (%)">
                  <Input type="number" inputMode="decimal" step="0.1" placeholder="örn. 100" value={form.achievement_accepted} onChange={(e) => set("achievement_accepted", e.target.value)} disabled={closed} />
                </Field>
                <Field label="Komisyon elle (tabloyu geçersiz kılar)">
                  <MoneyInput value={form.commission_override} onChange={(v) => set("commission_override", v)} disabled={closed} placeholder="boş = tablo" />
                </Field>
                <Field label="Komisyon notu (ÖZEL kararı: kim, ne zaman)" wide>
                  <Input value={form.commission_note} onChange={(e) => set("commission_note", e.target.value)} disabled={closed} placeholder="örn. %99,7 → %100 KABUL (Alp 07.10)" />
                </Field>
              </Section>
            ) : null}

            <Section title="Primler">
              {line.perfume_eligible || line.perfume_units > 0 ? (
                <Field label="Parfüm adedi (×50 ₺)">
                  <Input type="number" inputMode="numeric" min={0} value={form.perfume_units} onChange={(e) => set("perfume_units", e.target.value)} disabled={closed} />
                </Field>
              ) : null}
              {line.garment_eligible || line.garment_units > 0 ? (
                <Field label="Giysi adedi (×200 ₺)">
                  <Input type="number" inputMode="numeric" min={0} value={form.garment_units} onChange={(e) => set("garment_units", e.target.value)} disabled={closed} />
                </Field>
              ) : null}
              <label className="flex items-center gap-2 text-sm pt-5">
                <input type="checkbox" className="h-4 w-4" checked={form.top_seller} onChange={(e) => set("top_seller", e.target.checked)} disabled={closed} />
                Top-seller (ayın en çok satanı, 3.000 ₺)
              </label>
              <Field label="Ek prim">
                <MoneyInput value={form.extra_premium} onChange={(v) => set("extra_premium", v)} disabled={closed} />
              </Field>
              <Field label="Ek prim açıklaması" wide>
                <Input value={form.extra_premium_note} onChange={(e) => set("extra_premium_note", e.target.value)} disabled={closed} />
              </Field>
            </Section>

            <Section title="Not (denetim izi)">
              <div className="col-span-2">
                <textarea
                  className="w-full min-h-[72px] rounded-md border bg-background px-3 py-2 text-sm"
                  value={form.note}
                  onChange={(e) => set("note", e.target.value)}
                  disabled={closed}
                  placeholder="Belirsiz her rakamın nedeni, kim karar verdi, ne zaman…"
                />
              </div>
            </Section>

            <div className="flex items-center gap-2">
              <Button onClick={save} disabled={update.isPending || closed}>
                Kaydet
              </Button>
              <Button variant="outline" asChild>
                <a href={`/tr/payroll/payslip/${line.id}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Bordro fişi
                </a>
              </Button>
            </div>
          </div>

          {/* Hesap ve kayıtlar */}
          <div className="space-y-4">
            <Section title="Hesap dökümü (kayıtlı değerlerle)" single>
              <table className="w-full text-sm">
                <tbody>
                  <Row label="Baz maaş" v={line.base_salary} />
                  <Row label={`Mesai ${line.overtime_hours ? `(${line.overtime_hours} s × ${money(c.hourly_rate)})` : ""}`} v={c.overtime_amount} />
                  <Row label="Komisyon" v={c.commission.final} />
                  {c.perfume_amount ? <Row label={`Parfüm primi (${line.perfume_units} adet)`} v={c.perfume_amount} /> : null}
                  {c.garment_amount ? <Row label={`Giysi primi (${line.garment_units} adet)`} v={c.garment_amount} /> : null}
                  {c.top_seller_amount ? <Row label="Top-seller" v={c.top_seller_amount} /> : null}
                  {c.extra_premium ? <Row label="Ek prim" v={c.extra_premium} /> : null}
                  {c.additions_total ? <Row label="Ek hak edişler" v={c.additions_total} /> : null}
                  {c.deductions_total ? <Row label="Kesintiler" v={-c.deductions_total} tone="text-rose-700" /> : null}
                  <Row label="Brüt hak ediş" v={c.gross} bold />
                  <Row label="Avanslar" v={-c.advances_total} tone="text-amber-800" />
                  <Row label="Ödemeler" v={-c.payments_total} />
                  <Row label="NET KALAN" v={c.net_remaining} bold tone={Math.abs(c.net_remaining) <= 0.5 ? "text-emerald-700" : "text-amber-800"} />
                </tbody>
              </table>
              {p !== "none" ? (
                <div className="mt-2 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground space-y-0.5">
                  {c.commission.explanation.map((t, i) => (
                    <div key={i}>{t}</div>
                  ))}
                  {c.commission.rate != null ? <div>Uygulanan oran: {rate(c.commission.rate)}</div> : null}
                </div>
              ) : null}
              <div className="mt-2 text-xs text-muted-foreground">
                Ödeme 1 için şu an ödenecek: <b>{money(c.payment1_due)} ₺</b> · Ödeme 2: <b>{money(c.payment2_due)} ₺</b>
              </div>
            </Section>

            <Section title="Kayıtlar — avans, ödeme, kesinti, ek hak ediş" single>
              {!closed ? (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(["advance", "payment", "deduction", "addition"] as const).map((k) => (
                    <Button key={k} size="sm" variant="outline" onClick={() => setEntryKind(k)}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      {KIND_LABEL[k]}
                    </Button>
                  ))}
                </div>
              ) : null}
              {c.entries.length === 0 ? (
                <div className="text-sm text-muted-foreground">Kayıt yok.</div>
              ) : (
                <ul className="divide-y text-sm">
                  {c.entries.map((e) => (
                    <li key={e.id} className={cn("py-2 space-y-1", !e.counted && "opacity-60")}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium ring-1", KIND_TONE[e.kind])}>{KIND_LABEL[e.kind]}</span>
                        <span className="tabular-nums text-muted-foreground">{dmy(String(e.entry_date))}</span>
                        <span className={cn("tabular-nums font-medium", !e.counted && "line-through")}>{money(e.amount)} ₺</span>
                        {e.channel ? <span className="text-xs text-muted-foreground">{e.channel}</span> : null}
                        {e.category ? <span className="text-xs text-muted-foreground">{e.category}</span> : null}
                        {e.counted_note ? <span className="text-xs text-rose-700">{e.counted_note}</span> : null}
                        {!closed && !e.voided_at ? (
                          <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-rose-700" onClick={() => setVoidId(e.id)}>
                            iptal
                          </button>
                        ) : null}
                      </div>
                      {e.note || e.reference ? (
                        <div className="text-xs text-muted-foreground">{[e.note, e.reference].filter(Boolean).join(" · ")}</div>
                      ) : null}
                      {voidId === e.id ? (
                        <div className="flex items-center gap-2">
                          <Input placeholder="İptal nedeni" value={voidNote} onChange={(ev) => setVoidNote(ev.target.value)} className="h-8" />
                          <Button size="sm" variant="destructive" onClick={() => voidEntry.mutate({ id: e.id, note: voidNote })} disabled={voidEntry.isPending || voidNote.trim().length < 3}>
                            İptal et
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setVoidId(null)}>
                            Vazgeç
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>

        {entryKind ? (
          <EntryDialog
            lineId={line.id}
            employeeId={line.employee_id}
            fullName={line.full_name}
            kind={entryKind}
            onClose={() => setEntryKind(null)}
            onCreated={onChanged}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children, single }: { title: string; children: React.ReactNode; single?: boolean }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      {single ? children : <div className="grid grid-cols-2 gap-3">{children}</div>}
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("space-y-1", wide && "col-span-2")}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Row({ label, v, bold, tone }: { label: string; v: number; bold?: boolean; tone?: string }) {
  return (
    <tr className={cn(bold && "border-t font-semibold")}>
      <td className="py-1 pr-2">{label}</td>
      <td className={cn("py-1 text-right tabular-nums", tone)}>{money(v)}</td>
    </tr>
  );
}
