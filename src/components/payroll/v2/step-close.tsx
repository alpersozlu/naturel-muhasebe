"use client";

import { AlertTriangle, CheckCircle2, Lock, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ComputedLine, PeriodView } from "@/server/services/payroll/period";
import { money } from "../format";
import { BatchList } from "./batch-list";
import { Chip, Dash, ROW, StepHeader, TD, TH } from "./parts";

/**
 * 4. ADIM — KAPANIŞ. Ay, herkesin kalanı sıfırlanınca kapanır. Burada yalnız
 * kapanışı engelleyenler ve bakılması gerekenler durur: uyarılar, kalanı açık
 * kişiler ve ayın bütün talimatları.
 */
export function StepClose({
  data,
  busy,
  onOpenLine,
  onChanged,
  onClosePeriod,
  onReopenPeriod,
}: {
  data: PeriodView;
  busy: boolean;
  onOpenLine: (id: string) => void;
  onChanged: () => void;
  onClosePeriod: () => void;
  onReopenPeriod: () => void;
}) {
  const closed = data.period.status === "closed";
  const open = data.stores.flatMap((s) => s.lines).filter((l) => Math.abs(l.calc.net_remaining) > 0.5);
  const ready = open.length === 0;

  return (
    <div className="space-y-5">
      <StepHeader title="Kapanış" description="Herkesin kalanı sıfırlanınca ay kapatılır. Kapalı ayda kayıt değişmez; gerekirse yeniden açılır.">
        {closed ? (
          <Button variant="outline" onClick={onReopenPeriod} disabled={busy}>
            <Unlock className="mr-2 h-4 w-4" />
            Ayı yeniden aç
          </Button>
        ) : (
          <Button onClick={onClosePeriod} disabled={busy || !ready} title={ready ? undefined : "Önce kalanı açık kişileri kapatın"}>
            <Lock className="mr-2 h-4 w-4" />
            Ayı kapat
          </Button>
        )}
      </StepHeader>

      <div
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-2xl border px-5 py-4 text-sm",
          closed ? "bg-muted/40" : ready ? "border-emerald-200 bg-emerald-50/60 text-emerald-950" : "border-amber-200 bg-amber-50/60 text-amber-950"
        )}
      >
        {closed ? <Lock className="h-5 w-5 shrink-0" /> : ready ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />}
        <span className="font-medium">
          {closed
            ? `${data.period.label} kapalı.`
            : ready
              ? "Herkesin kalanı sıfır. Ay kapatılabilir."
              : `${open.length} kişinin kalanı sıfır değil. Bu satırlar kapanmadan ay kapatılamaz.`}
        </span>
      </div>

      {open.length ? (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <header className="flex items-baseline gap-3 border-b px-5 py-3.5">
            <h3 className="font-semibold tracking-tight">Kalanı açık kişiler</h3>
            <span className="text-sm text-muted-foreground">{open.length} kişi</span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] table-fixed text-sm">
              <thead>
                <tr>
                  <th className={TH}>Çalışan</th>
                  <th className={cn(TH, "w-[16%] text-left")}>Mağaza</th>
                  <th className={cn(TH, "w-[13%]")}>Kalan maaş</th>
                  <th className={cn(TH, "w-[13%]")}>Kalan prim</th>
                  <th className={cn(TH, "w-[13%]")}>Net kalan</th>
                  <th className={cn(TH, "w-[22%] text-left")}>Ne yapılmalı</th>
                </tr>
              </thead>
              <tbody>
                {open.map((l) => (
                  <OpenRow key={l.id} l={l} onOpen={() => onOpenLine(l.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data.alerts.length ? (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <header className="flex items-baseline gap-3 border-b px-5 py-3.5">
            <h3 className="font-semibold tracking-tight">Kontrol edilmesi gerekenler</h3>
            <span className="text-sm text-muted-foreground">{data.alerts.length} uyarı</span>
          </header>
          <ul className="divide-y text-sm">
            {data.alerts.map((a, i) => (
              <li key={`${a.line_id}-${i}`}>
                <button type="button" onClick={() => onOpenLine(a.line_id)} className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none">
                  <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", a.level === "error" ? "text-rose-600" : "text-amber-600")} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{a.full_name}</span>
                    <span className="text-muted-foreground"> · {a.store_name}</span>
                    <span className="block text-muted-foreground">{a.text}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <BatchList data={data} title="Ayın bütün talimat ve listeleri" onChanged={onChanged} />
    </div>
  );
}

function OpenRow({ l, onOpen }: { l: ComputedLine; onOpen: () => void }) {
  const c = l.calc;
  const todo =
    c.net_remaining < -0.5
      ? l.employee_status === "left"
        ? "Ayrıldı: iade bekleniyor"
        : "Sonraki aya devret"
      : c.payment1_due > 0.5
        ? "Maaşı öde (2. adım)"
        : "Primi öde (3. adım)";
  return (
    <tr className={ROW} tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <td className={TD}>
        <div className="font-medium">{l.full_name}</div>
        <div className="text-sm text-muted-foreground">{l.position}</div>
      </td>
      <td className={cn(TD, "text-left text-muted-foreground")}>{l.store_name}</td>
      <td className={TD}>{c.payment1_due > 0.5 ? money(c.payment1_due) : <Dash />}</td>
      <td className={TD}>{c.payment2_due > 0.5 ? money(c.payment2_due) : <Dash />}</td>
      <td className={cn(TD, "font-semibold", c.net_remaining < 0 ? "text-rose-700" : "text-amber-800")}>
        {c.net_remaining < 0 ? "− " : ""}
        {money(Math.abs(c.net_remaining))}
      </td>
      <td className={cn(TD, "text-left")}>
        <Chip tone={c.net_remaining < -0.5 ? "bad" : "wait"}>{todo}</Chip>
      </td>
    </tr>
  );
}
