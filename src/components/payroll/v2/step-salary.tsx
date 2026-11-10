"use client";

import { FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ComputedLine, PeriodView } from "@/server/services/payroll/period";
import { PAY_METHOD_SHORT } from "@/server/services/payroll/rules";
import type { BatchChoice } from "../batch-dialog";
import { money } from "../format";
import { BatchList } from "./batch-list";
import { Chip, Dash, ROW, salaryPaid, StepHeader, StoreShell, TD, TH } from "./parts";

/**
 * 2. ADIM — MAAŞ (ÖDEME 1). Her satır bir denklemdir:
 * baz maaş + ek − kesinti − avans − ödenen = kalan maaş.
 * Mesai, prim ve Ödeme 2 burada yoktur — onlar 3. adımda.
 */
export function StepSalary({
  data,
  closed,
  onBatch,
  onOpenLine,
  onChanged,
}: {
  data: PeriodView;
  closed: boolean;
  onBatch: (c: BatchChoice) => void;
  onOpenLine: (id: string) => void;
  onChanged: () => void;
}) {
  const t = data.totals;
  const due = data.stores.flatMap((s) => s.lines).reduce((s, l) => s + l.calc.payment1_due, 0);
  return (
    <div className="space-y-5">
      <StepHeader title="Maaş — Ödeme 1" description="Baz maaştan avans ve kesintiler düşülür; kalan ayın 1–3’ünde ödenir. Mesai ve primler sonraki adımdadır.">
        <Button onClick={() => onBatch({ kind: "payment1", channel: "garanti" })} disabled={closed}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Garanti talimatı
        </Button>
        <Button variant="outline" onClick={() => onBatch({ kind: "payment1", channel: "ziraat" })} disabled={closed}>
          Ziraat ödendi
        </Button>
        <Button variant="outline" onClick={() => onBatch({ kind: "payment1", channel: "cash" })} disabled={closed}>
          Nakit ödendi
        </Button>
      </StepHeader>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border bg-card px-5 py-3.5 text-sm shadow-xs">
        <span>
          <span className="text-muted-foreground">Maaşı ödenen </span>
          <b className="text-base tabular-nums">
            {t.base_paid_count} / {t.base_lines}
          </b>
        </span>
        <span>
          <span className="text-muted-foreground">Ödenecek maaş </span>
          <b className={cn("text-base tabular-nums", due > 0.5 ? "text-amber-800" : "text-emerald-700")}>{money(due)} ₺</b>
        </span>
        {t.base_lines > 0 && t.base_paid_count === t.base_lines ? <Chip tone="ok">tüm maaşlar ödendi</Chip> : null}
      </div>

      {data.stores.map((s) => {
        const lines = s.lines.filter((l) => l.employee_status !== "inactive");
        const inactive = s.lines.filter((l) => l.employee_status === "inactive");
        if (lines.length === 0 && inactive.length === 0) return null;
        const storeDue = lines.reduce((x, l) => x + l.calc.payment1_due, 0);
        return (
          <StoreShell
            key={s.store_id}
            title={s.store_name}
            subtitle={`${lines.length} kişi`}
            right={
              storeDue > 0.5 ? (
                <span className="text-sm text-muted-foreground">
                  ödenecek <b className="text-base font-semibold tabular-nums text-amber-800">{money(storeDue)} ₺</b>
                </span>
              ) : (
                <Chip tone="ok">maaşlar ödendi</Chip>
              )
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] table-fixed text-sm">
                <thead>
                  <tr>
                    <th className={TH}>Çalışan</th>
                    <th className={cn(TH, "w-[14%]")}>Baz maaş</th>
                    <th className={cn(TH, "w-[14%]")}>Ek · kesinti</th>
                    <th className={cn(TH, "w-[14%]")}>Avans</th>
                    <th className={cn(TH, "w-[14%]")}>Ödenen</th>
                    <th className={cn(TH, "w-[14%]")}>Kalan maaş</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <SalaryRow key={l.id} l={l} onOpen={() => onOpenLine(l.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          </StoreShell>
        );
      })}

      <BatchList data={data} kinds={["payment1", "single"]} title="Maaş talimatları ve listeleri" onChanged={onChanged} />
    </div>
  );
}

function SalaryRow({ l, onOpen }: { l: ComputedLine; onOpen: () => void }) {
  const c = l.calc;
  const paid = salaryPaid(c);
  return (
    <tr className={ROW} tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <td className={TD}>
        <div className="font-medium">{l.full_name}</div>
        <div className="text-sm text-muted-foreground">
          {l.position} · {PAY_METHOD_SHORT[l.pay_method]}
          {l.employee_status === "left" ? " · ayrıldı" : ""}
        </div>
      </td>
      <td className={TD}>
        {l.paid_by_day ? <span className="text-muted-foreground">günle ödenir</span> : money(l.base_salary)}
        {!l.paid_by_day && l.worked_days != null ? <div className="text-sm text-muted-foreground">{l.worked_days} gün</div> : null}
      </td>
      <td className={TD}>
        {c.additions_total > 0.005 ? <div className="text-emerald-700">+ {money(c.additions_total)}</div> : null}
        {c.deductions_from_salary > 0.005 ? <div className="text-rose-700">− {money(c.deductions_from_salary)}</div> : null}
        {c.additions_total <= 0.005 && c.deductions_from_salary <= 0.005 ? <Dash /> : null}
      </td>
      <td className={TD}>{c.advances_total > 0.005 ? `− ${money(c.advances_total)}` : <Dash />}</td>
      <td className={TD}>{paid > 0.005 ? money(paid) : <Dash />}</td>
      <td className={TD}>
        {l.paid_month_early && c.payment1_due <= 0.5 ? (
          <Chip tone="muted">bir ay önceden ödendi</Chip>
        ) : l.base_salary <= 0 && c.payment1_due <= 0.5 ? (
          <Dash />
        ) : c.base_paid ? (
          <Chip tone="ok">ödendi</Chip>
        ) : (
          <span className="font-semibold text-amber-800">{money(c.payment1_due)}</span>
        )}
      </td>
    </tr>
  );
}
