"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PeriodView } from "@/server/services/payroll/period";
import { ADDITION_CATEGORIES, CARRY_FORWARD_CATEGORY, DEDUCTION_CATEGORIES, REFUND_RECEIVED_CATEGORY } from "@/server/services/payroll/rules";
import { money, todayIso } from "../format";
import { LABEL } from "./parts";

/**
 * TOPLU KESİNTİ / EKLEME — aynı sebeple birden çok kişiye tek seferde kayıt.
 *
 * Etiket farkı, kasa eksiği, faturasız masraf gibi kesintiler çoğu zaman bir
 * mağazanın bütün personeline aynı gün, aynı notla yazılır. Eskiden her kişi
 * için pencere açmak gerekiyordu. Burada sebep ve not bir kez yazılır,
 * mağaza (ya da tek tek kişi) seçilir; tutar herkese aynıdır ama kişi bazında
 * değiştirilebilir. Her kayıt uygulamanın normal "kayıt ekle" işlemiyle
 * yazılır (denetim izi kişi kişi düşer).
 */
export function BulkEntryDialog({ data, onClose, onChanged }: { data: PeriodView; onClose: () => void; onChanged: () => void }) {
  const [kind, setKind] = useState<"deduction" | "addition">("deduction");
  const [category, setCategory] = useState<string>("price_difference");
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [own, setOwn] = useState<Record<string, number | undefined>>({});
  const [busy, setBusy] = useState(false);
  const create = trpc.payroll.entries.create.useMutation();

  const categories = useMemo(() => {
    const dict: Record<string, string> = kind === "deduction" ? DEDUCTION_CATEGORIES : ADDITION_CATEGORIES;
    // Devir ve iade tek kişilik işlemlerdir; toplu girişte yer almaz.
    return Object.entries(dict).filter(([k]) => k !== CARRY_FORWARD_CATEGORY && k !== REFUND_RECEIVED_CATEGORY && k !== "carry_over");
  }, [kind]);

  const stores = data.stores
    .map((s) => ({ ...s, lines: s.lines.filter((l) => l.employee_status !== "inactive") }))
    .filter((s) => s.lines.length > 0);
  const chosen = stores.flatMap((s) => s.lines).filter((l) => picked[l.id]);
  const amountOf = (id: string) => own[id] ?? amount ?? 0;
  const total = chosen.reduce((s, l) => s + amountOf(l.id), 0);
  const ready = chosen.length > 0 && note.trim().length >= 3 && chosen.every((l) => amountOf(l.id) > 0);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const failed: string[] = [];
    let ok = 0;
    for (const l of chosen) {
      try {
        await create.mutateAsync({
          line_id: l.id,
          kind,
          category,
          channel: null,
          entry_date: date,
          amount: amountOf(l.id),
          note: note.trim(),
          reference: reference.trim() || null,
          loan_id: null,
        });
        ok += 1;
        setPicked((m) => ({ ...m, [l.id]: false }));
      } catch (e) {
        failed.push(`${l.full_name}: ${e instanceof Error ? e.message : "kaydedilemedi"}`);
      }
    }
    setBusy(false);
    if (ok) onChanged();
    if (failed.length) {
      toast.error(`${ok} kişi kaydedildi, ${failed.length} kişi kaydedilemedi`, { description: failed.join("\n"), duration: 12000 });
      return;
    }
    toast.success(`${ok} kişiye ${kind === "deduction" ? "kesinti" : "ekleme"} yazıldı · toplam ${money(total)} ₺`);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6">
          <DialogTitle>Toplu kesinti / ekleme · {data.period.label}</DialogTitle>
          <DialogDescription>Sebebi ve notu bir kez yazın, kişileri seçin. Herkese ayrı kayıt düşer; yanlış kayıt kişinin panelinden iptal edilir.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="col-span-2 space-y-1.5">
              <div className={LABEL}>Tür</div>
              <div className="inline-flex rounded-lg border p-0.5 text-sm" role="radiogroup" aria-label="Kayıt türü">
                {(
                  [
                    ["deduction", "Kesinti"],
                    ["addition", "Ekleme"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    onClick={() => {
                      setKind(k);
                      setCategory(k === "deduction" ? "price_difference" : "bonus");
                    }}
                    className={cn(
                      "rounded-md px-4 py-1.5 font-medium transition-colors",
                      kind === k ? (k === "deduction" ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800") : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className={cn(LABEL, "block")} htmlFor="bulk-cat">
                Sebep
              </label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="bulk-cat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className={cn(LABEL, "block")} htmlFor="bulk-amount">
                Kişi başı tutar (₺)
              </label>
              <MoneyInput id="bulk-amount" value={amount} onChange={setAmount} placeholder="0,00" className="text-right" autoFocus />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className={cn(LABEL, "block")} htmlFor="bulk-date">
                Tarih
              </label>
              <Input id="bulk-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="col-span-2 space-y-1.5 sm:col-span-4">
              <label className={cn(LABEL, "block")} htmlFor="bulk-note">
                Not (zorunlu)
              </label>
              <Input id="bulk-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ne için, kim karar verdi, ne zaman" />
            </div>
            <div className="col-span-2 space-y-1.5 sm:col-span-4">
              <label className={cn(LABEL, "block")} htmlFor="bulk-ref">
                Referans (isteğe bağlı)
              </label>
              <Input id="bulk-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Fiş no, rapor adı, dönem" />
            </div>
          </div>

          <div className="space-y-3">
            <div className={LABEL}>Kişiler</div>
            {stores.map((s) => {
              const ids = s.lines.map((l) => l.id);
              const n = ids.filter((id) => picked[id]).length;
              const all = n === ids.length;
              return (
                <div key={s.store_id} className="overflow-hidden rounded-xl border">
                  <label className="flex cursor-pointer items-center gap-3 bg-muted/40 px-4 py-2.5 text-sm font-medium">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[hsl(var(--primary))]"
                      checked={all}
                      ref={(el) => {
                        if (el) el.indeterminate = n > 0 && !all;
                      }}
                      onChange={(e) => setPicked((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, e.target.checked])) }))}
                    />
                    {s.store_name}
                    <span className="ml-auto font-normal text-muted-foreground">
                      {n ? `${n} / ${ids.length} seçili` : `${ids.length} kişi`}
                    </span>
                  </label>
                  <ul className="divide-y border-t">
                    {s.lines.map((l) => (
                      <li key={l.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={!!picked[l.id]} onChange={(e) => setPicked((m) => ({ ...m, [l.id]: e.target.checked }))} />
                          <span className="truncate">{l.full_name}</span>
                          <span className="truncate text-muted-foreground">
                            {l.position}
                            {l.employee_status === "left" ? " · ayrıldı" : ""}
                          </span>
                        </label>
                        {picked[l.id] ? (
                          <MoneyInput value={own[l.id] ?? amount} onChange={(v) => setOwn((m) => ({ ...m, [l.id]: v }))} className="h-8 w-32 text-right" placeholder="0,00" aria-label={`${l.full_name} tutarı`} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t bg-background px-6 py-4">
          <div className="text-sm">
            <span className="text-muted-foreground">{chosen.length} kişi · toplam </span>
            <b className="tabular-nums">{money(total)} ₺</b>
            {chosen.length > 0 && !ready ? <span className="ml-3 text-amber-800">{note.trim().length < 3 ? "Not yazın" : "Tutar girin"}</span> : null}
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Vazgeç
            </Button>
            <Button onClick={submit} disabled={!ready || busy}>
              {busy ? "Yazılıyor…" : chosen.length === 0 ? "Kişi seçin" : kind === "deduction" ? `${chosen.length} kişiden kes` : `${chosen.length} kişiye ekle`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
