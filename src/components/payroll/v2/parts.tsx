"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { LineCalc } from "@/server/services/payroll/compute";
import {
  ADDITION_CATEGORIES,
  CARRY_FORWARD_CATEGORY,
  CARRY_FORWARD_LABEL,
  DEDUCTION_CATEGORIES,
  PAYMENT_CATEGORIES,
} from "@/server/services/payroll/rules";

/** Durum dili — sayfanın her yerinde aynı beş ton. Renk yanında hep metin vardır. */
export type Tone = "ok" | "wait" | "bad" | "muted" | "brand" | "carry";

const TONE: Record<Tone, string> = {
  ok: "bg-emerald-50 text-emerald-800 ring-emerald-200/80",
  wait: "bg-amber-50 text-amber-900 ring-amber-200/80",
  bad: "bg-rose-50 text-rose-800 ring-rose-200/80",
  muted: "bg-slate-100 text-slate-700 ring-slate-200",
  brand: "bg-primary/10 text-primary ring-primary/25",
  carry: "bg-violet-50 text-violet-800 ring-violet-200/80",
};

export function Chip({ tone = "muted", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1", TONE[tone], className)}>
      {children}
    </span>
  );
}

export const Dash = () => <span className="text-muted-foreground/60">—</span>;

/** Küçük başlık etiketi (tablo başlıkları, alan adları). 12 px'in altına inmez. */
export const LABEL = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** Adım başlığı: ne olduğu tek cümle + o adımın işlemleri. */
export function StepHeader({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** Mağaza kartı kabuğu — bütün adımlarda aynı başlık düzeni. */
export function StoreShell({
  title,
  subtitle,
  right,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-5 py-3.5">
        <div className="min-w-0">
          <h3 className="font-semibold tracking-tight">{title}</h3>
          {subtitle ? <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div> : null}
        </div>
        {right ? <div className="ml-auto flex flex-wrap items-center gap-3">{right}</div> : null}
      </header>
      {children}
      {footer}
    </section>
  );
}

/** Tablo hücre sınıfları — bütün adımlarda aynı ritim. */
export const TH = "whitespace-nowrap px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground first:pl-5 first:text-left last:pr-5";
export const TD = "whitespace-nowrap px-3 py-3 text-right align-top tabular-nums first:whitespace-normal first:pl-5 first:text-left last:pr-5";
export const ROW = "border-t transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none cursor-pointer";

/** Maaş olarak fiilen ödenen: ödemeler − Ödeme 2 (avans ayrı sütunda). */
export function salaryPaid(c: LineCalc): number {
  return Math.round((c.payments_total - c.payment2_paid) * 100) / 100;
}

/** Top-seller + giysi + parfüm + ek prim (satış primi ve mesai ayrı sütunda). */
export function otherPremiums(c: LineCalc): number {
  return Math.round((c.top_seller_amount + c.garment_amount + c.perfume_amount + c.extra_premium) * 100) / 100;
}

/**
 * Kayıt türüne göre sebep etiketi. Kesinti ve ekleme sözlüklerinin ikisinde de
 * "other" var; tek sözlükte birleşince "Diğer kesinti" "Diğer ek hak ediş"
 * görünüyordu (07.10.2026) — bu yüzden türe göre ayrı bakılır.
 */
export function categoryLabel(kind: "deduction" | "addition" | "advance" | "payment", category: string | null): string {
  if (category === CARRY_FORWARD_CATEGORY) return CARRY_FORWARD_LABEL;
  if (kind === "advance") return "Avans";
  const dict: Record<string, string> =
    kind === "deduction" ? DEDUCTION_CATEGORIES : kind === "addition" ? ADDITION_CATEGORIES : PAYMENT_CATEGORIES;
  return dict[category ?? ""] ?? (kind === "deduction" ? "Kesinti" : kind === "addition" ? "Ek hak ediş" : "Ödeme");
}

/** Açılır-kapanır bölüm başlığı (yerel <details> — klavye ve ekran okuyucu hazır). */
export function Disclosure({
  title,
  hint,
  defaultOpen,
  children,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details open={defaultOpen} className={cn("group rounded-xl border bg-card", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium hover:bg-accent/50 [&::-webkit-details-marker]:hidden">
        <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden>
          <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{title}</span>
        {hint ? <span className="ml-auto text-sm font-normal text-muted-foreground">{hint}</span> : null}
      </summary>
      <div className="border-t px-4 py-4">{children}</div>
    </details>
  );
}
