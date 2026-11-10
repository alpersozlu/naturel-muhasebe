"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/ui/money-input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ComputedLine, StoreBlock } from "@/server/services/payroll/period";
import { computeLine } from "@/server/services/payroll/compute";
import { money, pct } from "../format";
import { draftFromLine, draftToInput, type LineDraft } from "./line-draft";
import { LABEL } from "./parts";

type Row = Pick<LineDraft, "own_revenue_nd" | "own_revenue_denim" | "own_revenue" | "own_target">;

const rowOf = (l: ComputedLine): Row => ({
  own_revenue_nd: l.own_revenue_nd ?? undefined,
  own_revenue_denim: l.own_revenue_denim ?? undefined,
  own_revenue: l.own_revenue ?? undefined,
  own_target: l.own_target ?? undefined,
});
const sameRow = (a: Row, b: Row) => JSON.stringify(a) === JSON.stringify(b);

/**
 * CİRO VE HEDEFLER — bir mağazanın satış primini belirleyen bütün rakamlar tek
 * pencerede: mağaza cirosu, merkez hedefi ve satış asistanlarının kişisel ciro
 * ve hedefleri. Yazarken başarı ve prim aynı motorla hesaplanır; "Kaydet"
 * yalnız değişenleri gönderir.
 */
export function StoreTargetsDialog({
  store,
  periodId,
  periodLabel,
  closed,
  onClose,
  onChanged,
}: {
  store: StoreBlock;
  periodId: string;
  periodLabel: string;
  closed: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const people = store.lines.filter(
    (l) => (l.commission_profile === "mavi_asistan" || l.commission_profile === "deri_asistan") && l.employee_status !== "inactive"
  );
  const managers = store.lines.filter(
    (l) => (l.commission_profile === "mavi_mudur" || l.commission_profile === "mavi_vice" || l.commission_profile === "deri_mudur") && l.employee_status !== "inactive"
  );
  const [revenue, setRevenue] = useState<number | undefined>(store.revenue ?? undefined);
  const [target, setTarget] = useState<number | undefined>(store.target ?? undefined);
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(people.map((l) => [l.id, rowOf(l)])));
  const [busy, setBusy] = useState(false);
  const upsert = trpc.payroll.storeMonth.upsert.useMutation();
  const update = trpc.payroll.lines.update.useMutation();

  const storeDirty = (revenue ?? null) !== (store.revenue ?? null) || (target ?? null) !== (store.target ?? null);
  const dirtyPeople = people.filter((l) => !sameRow(rows[l.id] ?? rowOf(l), rowOf(l)));
  const dirty = storeDirty || dirtyPeople.length > 0;
  const storeIn = { revenue: revenue ?? null, target: target ?? null };
  const ach = revenue && target ? revenue / target : null;
  const patch = (id: string, p: Partial<Row>) => setRows((m) => ({ ...m, [id]: { ...m[id]!, ...p } }));
  const isMavi = store.is_mavi;

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      if (storeDirty) await upsert.mutateAsync({ period_id: periodId, store_id: store.store_id, revenue: revenue ?? null, target: target ?? null });
      for (const l of dirtyPeople) {
        const r = rows[l.id]!;
        const o = rowOf(l);
        await update.mutateAsync({
          id: l.id,
          own_revenue_nd: l.commission_profile === "mavi_asistan" && r.own_revenue_nd !== o.own_revenue_nd ? (r.own_revenue_nd ?? null) : undefined,
          own_revenue_denim: l.commission_profile === "mavi_asistan" && r.own_revenue_denim !== o.own_revenue_denim ? (r.own_revenue_denim ?? null) : undefined,
          own_revenue: l.commission_profile === "deri_asistan" && r.own_revenue !== o.own_revenue ? (r.own_revenue ?? null) : undefined,
          own_target: r.own_target !== o.own_target ? (r.own_target ?? null) : undefined,
        });
      }
      toast.success(`${store.store_name}: ciro ve hedefler kaydedildi`);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kaydedilemedi");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const calcOf = (l: ComputedLine) => computeLine(draftToInput(l, { ...draftFromLine(l), ...(rows[l.id] ?? rowOf(l)) }), storeIn, l.calc.entries);

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6">
          <DialogTitle>
            Ciro ve hedefler · {store.store_name} · {periodLabel}
          </DialogTitle>
          <DialogDescription>
            Satış primi bu rakamlardan hesaplanır. {isMavi ? "Mavi’de kişi ciroları ay sonu belgelerinden kendiliğinden gelir; hedefleri siz girersiniz." : "Derimod ciroları Nebim’den alınır; hedefleri siz girersiniz."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section>
            <div className={cn(LABEL, "mb-2")}>Mağaza</div>
            <div className="flex flex-wrap items-end gap-4">
              <label className="space-y-1">
                <span className="block text-sm text-muted-foreground">Mağaza cirosu (net, KDV hariç)</span>
                <MoneyInput value={revenue} onChange={setRevenue} className="h-10 w-48 text-right" disabled={closed} />
              </label>
              <label className="space-y-1">
                <span className="block text-sm text-muted-foreground">Merkez hedefi (aylık)</span>
                <MoneyInput value={target} onChange={setTarget} className="h-10 w-48 text-right" disabled={closed} />
              </label>
              <div className="pb-2 text-sm">
                <span className="text-muted-foreground">başarı </span>
                <b className={cn("text-base tabular-nums", ach == null ? "text-muted-foreground" : ach >= 1 ? "text-emerald-700" : ach >= 0.95 ? "text-amber-800" : "text-rose-700")}>{ach != null ? pct(ach) : "—"}</b>
              </div>
            </div>
            {store.revenue_source === "nebim" && !storeDirty ? <p className="mt-2 text-sm text-muted-foreground">Ciro Nebim’den alındı.</p> : null}
            {managers.length ? (
              <ul className="mt-3 divide-y rounded-xl border text-sm">
                {managers.map((l) => {
                  const c = calcOf(l);
                  return (
                    <li key={l.id} className="flex items-baseline gap-3 px-4 py-2.5">
                      <span className="font-medium">{l.full_name}</span>
                      <span className="text-muted-foreground">
                        {l.position}
                        {c.commission.rate != null ? ` · oran %${(c.commission.rate * 100).toLocaleString("tr-TR")}` : ""}
                      </span>
                      <span className="ml-auto text-muted-foreground">satış primi</span>
                      <b className="tabular-nums">{money(c.commission.final)}</b>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          <section>
            <div className={cn(LABEL, "mb-2")}>Satış asistanları</div>
            {people.length === 0 ? (
              <p className="text-sm text-muted-foreground">Bu mağazada kişisel hedefle çalışan satış asistanı yok.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left">
                      <th className={cn(LABEL, "px-4 py-2.5")}>Çalışan</th>
                      {isMavi ? (
                        <>
                          <th className={cn(LABEL, "px-2 py-2.5 text-right")}>Denim dışı ciro</th>
                          <th className={cn(LABEL, "px-2 py-2.5 text-right")}>Denim ciro</th>
                        </>
                      ) : (
                        <th className={cn(LABEL, "px-2 py-2.5 text-right")}>Kendi cirosu</th>
                      )}
                      <th className={cn(LABEL, "px-2 py-2.5 text-right")}>Kişisel hedef</th>
                      <th className={cn(LABEL, "px-2 py-2.5 text-right")}>Başarı</th>
                      <th className={cn(LABEL, "px-4 py-2.5 text-right")}>Satış primi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((l) => {
                      const r = rows[l.id] ?? rowOf(l);
                      const c = calcOf(l);
                      const a = c.commission.achievement_used;
                      return (
                        <tr key={l.id} className="border-b last:border-0">
                          <td className="px-4 py-2.5 font-medium">
                            {l.full_name}
                            {l.employee_status === "left" ? <span className="ml-2 font-normal text-muted-foreground">ayrıldı</span> : null}
                          </td>
                          {isMavi ? (
                            <>
                              <td className="px-2 py-2">
                                <MoneyInput value={r.own_revenue_nd} onChange={(v) => patch(l.id, { own_revenue_nd: v })} className="ml-auto h-9 w-36 text-right" disabled={closed} aria-label={`${l.full_name} denim dışı ciro`} />
                              </td>
                              <td className="px-2 py-2">
                                <MoneyInput value={r.own_revenue_denim} onChange={(v) => patch(l.id, { own_revenue_denim: v })} className="ml-auto h-9 w-36 text-right" disabled={closed} aria-label={`${l.full_name} denim ciro`} />
                              </td>
                            </>
                          ) : (
                            <td className="px-2 py-2">
                              <MoneyInput value={r.own_revenue} onChange={(v) => patch(l.id, { own_revenue: v })} className="ml-auto h-9 w-36 text-right" disabled={closed} aria-label={`${l.full_name} cirosu`} />
                            </td>
                          )}
                          <td className="px-2 py-2">
                            <MoneyInput value={r.own_target} onChange={(v) => patch(l.id, { own_target: v })} className={cn("ml-auto h-9 w-36 text-right", r.own_target == null && "border-amber-400")} placeholder="hedef girin" disabled={closed} aria-label={`${l.full_name} hedefi`} />
                          </td>
                          <td className={cn("px-2 py-2.5 text-right font-medium tabular-nums", a == null ? "text-muted-foreground" : a >= 1 ? "text-emerald-700" : "text-amber-800")}>{a != null ? pct(a) : "—"}</td>
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{money(c.commission.final)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t bg-background px-6 py-4">
          <span className="text-sm text-muted-foreground">{closed ? "Kapalı ay: değişiklik yapılamaz" : dirty ? `${dirtyPeople.length + (storeDirty ? 1 : 0)} değişiklik kaydedilmedi` : "Değişiklik yok"}</span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              {dirty ? "Vazgeç" : "Kapat"}
            </Button>
            <Button onClick={save} disabled={!dirty || busy || closed}>
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
