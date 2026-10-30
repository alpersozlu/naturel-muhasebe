"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Banknote, Minus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ChartSkeleton, StatCardSkeleton } from "@/components/shared/skeleton";
import type { CompareSide, RevenueSummary } from "@/server/services/analytics/revenue";

/*
 * GELİR ANALİZİ — sakin, renkli ama ölçülü. Her renk bir varlığa bağlıdır ve
 * sayfa boyunca aynı kalır: ödeme türleri (POS mavi, nakit yeşil, diğer
 * turuncu) ve markalar (Mavi mor, Derimod pembe). Paletler renk körlüğü
 * denetiminden geçti (dataviz validate_palette, 30.10.2026). Metin hiçbir
 * zaman seri rengini giymez, rengin yanında hep etiket ve tutar olur. Tutarlar kuruşlu ve
 * kısaltmasız (yalnız eksen etiketleri kısa). Her grafiğin yanında ekran
 * okuyucu için gizli bir veri tablosu vardır. Karşılaştırmalar aynı gün
 * aralığında ve iki tarafın verisi yeterliyse yapılır (sunucu: compare).
 */

// ───────────────── Biçim ─────────────────
const TRY2 = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const AXIS_FMT = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (n: number) => TRY2.format(n);
const fmtAxis = (n: number) => AXIS_FMT.format(n);
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const fmtPct = (n: number) => `%${n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const MONTHS_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const prevMonthOf = (y: number, m: number) => (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 });

// ───────────────── Renkler ─────────────────
const VIZ_VARS = {
  "--viz-pos": "#2a78d6",
  "--viz-cash": "#1baf7a",
  "--viz-other": "#eb6834",
  "--viz-pos-soft": "#9ec5f4",
  "--viz-mavi": "#6250d6",
  "--viz-derimod": "#e87ba4",
  "--viz-brand-other": "#8b8a86",
} as CSSProperties;
const INK = { pos: "var(--viz-pos)", cash: "var(--viz-cash)", other: "var(--viz-other)", posSoft: "var(--viz-pos-soft)" } as const;
/** Marka rengi markanın kendisine bağlı — sıralama değişse de değişmez. */
function brandColor(name: string | undefined): string {
  // "DERIMOD" Türkçe küçültmede "derımod" olur — ı'yı i'ye katla.
  const n = (name ?? "").toLocaleLowerCase("tr").replace(/ı/g, "i");
  if (n.includes("mavi")) return "var(--viz-mavi)";
  if (n.includes("derimod")) return "var(--viz-derimod)";
  return "var(--viz-brand-other)";
}
const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const GRID = "hsl(var(--border))";

// ───────────────── Ortak parçalar ─────────────────
function Panel({ title, subtitle, actions, className, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm", className)}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />;
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul aria-hidden className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Swatch color={it.color} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

type TipRow = { label: string; value: number; color?: string };
function InkTooltip({ title, rows, total }: { title: string; rows: TipRow[]; total?: number }) {
  return (
    <div className="min-w-[200px] rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-border">
      <p className="mb-1.5 font-medium">{title}</p>
      <ul className="grid gap-1">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {r.color ? <Swatch color={r.color} /> : null}
              {r.label}
            </span>
            <span className="font-medium tabular-nums">{fmt(r.value)} ₺</span>
          </li>
        ))}
      </ul>
      {total !== undefined ? (
        <div className="mt-1.5 flex justify-between gap-4 border-t border-border pt-1.5 font-semibold tabular-nums">
          <span>Toplam</span>
          <span>{fmt(total)} ₺</span>
        </div>
      ) : null}
    </div>
  );
}

/** Grafiğin ekran okuyucu karşılığı — renk ve fareye bağlı bilgi kalmasın. */
function SrTable({ caption, head, rows }: { caption: string; head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Karşılaştırma rozeti. Karşılaştırılabilirse yön oku + yüzde; dönemin verisi
 * eksikse ya da hiç yoksa nötr açıklama — yanıltıcı yeşil ok yok.
 */
function Delta({ side, label }: { side: CompareSide; label: string }) {
  if (side.comparable && side.change !== null) {
    const up = side.change >= 0;
    const Icon = up ? ArrowUpRight : ArrowDownRight;
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs font-medium tabular-nums", up ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">{up ? "Artış" : "Düşüş"} </span>
        {fmtPct(Math.abs(side.change * 100))}
        <span className="font-normal text-muted-foreground">{label} döneme göre</span>
      </span>
    );
  }
  const text =
    side.prev_store_days > 0
      ? `${label} verisi eksik — karşılaştırılmadı (${side.prev_store_days} mağaza-günü)`
      : `${label} için veri yok`;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Minus className="h-3.5 w-3.5" aria-hidden />
      {text}
    </span>
  );
}

// ───────────────── Üst bant ─────────────────
function Hero({ data, month, year }: { data: RevenueSummary; month: number; year: number }) {
  const pm = prevMonthOf(year, month);
  const end = data.compare.window_end_day;
  const windowText = data.coverage.ongoing ? `1–${end} ${MONTHS[month - 1]}` : `${MONTHS[month - 1]} ayı`;
  const parts = [
    { key: "pos", label: "POS / Kart", value: data.pos, color: INK.pos },
    { key: "cash", label: "Nakit", value: data.cash, color: INK.cash },
    { key: "other", label: "Diğer ödeme", hint: "Kartuş, çek, havale…", value: data.other, color: INK.other },
  ].filter((p) => Math.abs(p.value) >= 0.005);
  // Sisteme girilmeden önceki boş aylar çizilmez (eğri sıfırdan fırlamasın).
  const firstIdx = data.sparkline.findIndex((s) => s.total > 0);
  const spark = firstIdx >= 0 ? data.sparkline.slice(firstIdx) : [];

  return (
    <section aria-label="Ay toplamı" className="grid grid-cols-1 overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:grid-cols-5">
      <div className="p-6 lg:col-span-3 lg:p-8">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {MONTHS[month - 1]} {year} · Toplam ciro
        </div>
        <div className="mt-2 text-4xl font-semibold tabular-nums tracking-tight lg:text-5xl">
          {fmt(data.total)}
          <span className="ml-2 text-xl font-normal text-muted-foreground">₺</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground tabular-nums">
          {windowText} · {data.coverage.stores.length} mağaza · {data.active_days} günlük veri · günlük ortalama {fmt(data.daily_avg)} ₺
        </div>
        <div className="mt-4 flex flex-col gap-1.5">
          <Delta side={data.compare.mom} label={`${MONTHS_SHORT[pm.m - 1]} ${pm.y}`} />
          <Delta side={data.compare.yoy} label={`${MONTHS_SHORT[month - 1]} ${year - 1}`} />
        </div>
      </div>

      <div className="border-t border-border p-6 lg:col-span-2 lg:border-l lg:border-t-0 lg:p-8">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Ödeme dağılımı</div>
        <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={parts.map((p) => `${p.label} ${fmtPct(pct(p.value, data.total))}`).join(", ")}>
          {parts.map((p, i) => (
            <div key={p.key} className={cn("h-full", i > 0 && "border-l-2 border-card")} style={{ width: `${Math.max(0, pct(p.value, data.total))}%`, background: p.color }} />
          ))}
        </div>
        <ul className="mt-3 grid gap-1.5">
          {parts.map((p) => (
            <li key={p.key} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <Swatch color={p.color} />
                <span className="truncate" title={"hint" in p ? p.hint : undefined}>
                  {p.label}
                  {"hint" in p ? <span className="hidden text-muted-foreground/80 xl:inline"> · {p.hint}</span> : null}
                </span>
              </span>
              <span className="tabular-nums">
                <span className="font-medium">{fmt(p.value)} ₺</span>
                <span className="ml-2 inline-block w-12 text-right text-muted-foreground">{fmtPct(pct(p.value, data.total))}</span>
              </span>
            </li>
          ))}
        </ul>

        {spark.length >= 2 ? (
          <div className="mt-5">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Aylık ciro</div>
            <div aria-hidden className="h-16">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spark} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rev-spark" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={INK.pos} stopOpacity={0.12} />
                      <stop offset="100%" stopColor={INK.pos} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip
                    cursor={{ stroke: GRID }}
                    content={({ active, payload }) =>
                      active && payload?.[0] ? <InkTooltip title={String((payload[0].payload as { label: string }).label)} rows={[{ label: "Ciro", value: Number(payload[0].value) }]} /> : null
                    }
                  />
                  <Area type="monotone" dataKey="total" stroke={INK.pos} strokeWidth={2} fill="url(#rev-spark)" dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>{spark[0]?.label}</span>
              <span>{spark[spark.length - 1]?.label}</span>
            </div>
            <SrTable caption="Aylık ciro" head={["Ay", "Ciro (₺)"]} rows={spark.map((s) => [s.label, fmt(s.total)])} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ───────────────── Veri kapsamı ─────────────────
function Coverage({ data, month }: { data: RevenueSummary; month: number }) {
  const { stores, elapsed_days } = data.coverage;
  if (stores.length === 0 || elapsed_days === 0) return null;
  const have = stores.reduce((s, x) => s + x.days, 0);
  const want = stores.length * elapsed_days;
  const short = stores.filter((s) => s.days < elapsed_days * 0.8);
  return (
    <Panel
      title="Veri kapsamı"
      subtitle={
        <>
          Ciro yalnız gün sonu özeti yüklenmiş günlerden gelir · <span className="tabular-nums">{have} / {want}</span> mağaza-günü
        </>
      }
      actions={
        short.length > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
            <AlertTriangle className="h-3 w-3" aria-hidden /> {short.length} mağazada eksik gün
          </span>
        ) : null
      }
    >
      <ul className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {stores.map((s) => {
          const low = s.days < elapsed_days * 0.8;
          return (
            <li key={s.store_id}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-medium">{s.store_name}</span>
                <span className={cn("shrink-0 tabular-nums", low ? "font-medium text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>
                  {s.days} / {elapsed_days} gün
                </span>
              </div>
              <div
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={elapsed_days}
                aria-valuenow={s.days}
                aria-label={`${s.store_name} yüklenen gün`}
              >
                <div className="h-full rounded-full" style={{ width: `${pct(s.days, elapsed_days)}%`, background: low ? "rgb(217 119 6)" : INK.posSoft }} />
              </div>
              {s.first_day > 1 ? (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {s.first_day} {MONTHS_SHORT[month - 1]}&apos;den itibaren
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ───────────────── Ne oldu? ─────────────────
function insightsOf(data: RevenueSummary, month: number, year: number): string[] {
  const out: string[] = [];
  const pm = prevMonthOf(year, month);
  const mom = data.compare.mom;
  if (mom.comparable && mom.change !== null && Math.abs(mom.change) >= 0.03) {
    out.push(
      `${data.coverage.ongoing ? `1–${data.compare.window_end_day} günleri` : "Ay"} geçen ayın aynı günlerine göre ${fmtPct(Math.abs(mom.change * 100))} ${mom.change >= 0 ? "yüksek" : "düşük"}.`
    );
  } else if (mom.prev_store_days > 0 && !mom.comparable) {
    out.push(`${MONTHS[pm.m - 1]} verisi eksik yüklendiği için geçen ayla karşılaştırma yapılmadı.`);
  }
  const late = data.coverage.stores.filter((s) => s.first_day > 3);
  if (late.length > 0) {
    out.push(`${late.map((s) => s.store_name).join(", ")} için veri ${Math.min(...late.map((s) => s.first_day))} ${MONTHS[month - 1]}'den itibaren var — ay toplamı önceki günleri içermez.`);
  }
  const best = [...data.daily_series].sort((a, b) => b.total - a.total)[0];
  if (best && best.total > 0) out.push(`Ayın en güçlü günü ${best.day} ${MONTHS[month - 1]}: ${fmt(best.total)} ₺.`);
  const top = data.by_store[0];
  if (top && data.by_store.length >= 2) {
    const share = pct(top.total, data.total);
    if (share >= 30) out.push(`${top.store_name} toplam cironun ${fmtPct(share)}'ini tek başına yaptı.`);
  }
  const diff = data.bank_slips_total - data.pos;
  if (data.pos > 0 && Math.abs(diff) >= 1000) {
    out.push(`POS fişleri toplamı özetlerdeki kart toplamından ${fmt(Math.abs(diff))} ₺ ${diff < 0 ? "az" : "fazla"} — bazı günlerin fişi eksik ya da fazla olabilir.`);
  }
  return out.slice(0, 5);
}

function Insights({ data, month, year }: { data: RevenueSummary; month: number; year: number }) {
  const lines = insightsOf(data, month, year);
  if (lines.length === 0) return null;
  return (
    <Panel title="Bu ay ne oldu?">
      <ul className="grid gap-2">
        {lines.map((l) => (
          <li key={l} className="flex gap-2.5 text-sm leading-relaxed text-foreground/90">
            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: INK.pos }} />
            <span>{l}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ───────────────── Mağazalar ─────────────────
function Stores({ data }: { data: RevenueSummary }) {
  if (data.by_store.length === 0) return null;
  const max = data.by_store[0]?.total ?? 0;
  const brandOf = new Map(data.by_brand.flatMap((b) => b.stores.map((s) => [s.store_id, b.brand_name] as const)));
  const brands = data.by_brand.map((b) => b.brand_name);
  return (
    <Panel title="Mağaza sıralaması" subtitle="Toplam ciroya göre · nakit payı ile">
      {brands.length >= 2 ? <Legend items={brands.map((b) => ({ label: b, color: brandColor(b) }))} /> : null}
      <ol className="grid gap-3.5">
        {data.by_store.map((s, i) => (
          <li key={s.store_id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="truncate font-medium">{s.store_name}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold">{fmt(s.total)} ₺</span>
                <span className="ml-2 inline-block w-12 text-right text-xs text-muted-foreground">{fmtPct(pct(s.total, data.total))}</span>
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-3 pl-6">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${pct(s.total, max)}%`, background: brandColor(brandOf.get(s.store_id)) }} />
              </div>
              <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">nakit {fmtPct(pct(s.cash, s.total))}</span>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// ───────────────── Hafta günü ─────────────────
function Weekdays({ data }: { data: RevenueSummary }) {
  const wd = data.weekday_pattern;
  if (wd.length === 0 || wd.every((w) => w.total === 0)) return null;
  const maxAvg = Math.max(...wd.map((w) => w.avg));
  const best = wd.find((w) => w.avg === maxAvg && maxAvg > 0);
  return (
    <Panel title="Hafta günü deseni" subtitle="Günlük ortalama ciro (bütün mağazalar)">
      <div aria-hidden className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={wd} margin={{ top: 6, right: 0, left: 0, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={fmtAxis} width={44} />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))" }}
              content={({ active, payload }) => {
                const w = payload?.[0]?.payload as (typeof wd)[number] | undefined;
                return active && w ? <InkTooltip title={`${w.label} · ${w.days} gün`} rows={[{ label: "Günlük ortalama", value: w.avg }]} /> : null;
              }}
            />
            <Bar dataKey="avg" maxBarSize={28} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {wd.map((w) => (
                <Cell key={w.dow} fill={w === best ? INK.pos : INK.posSoft} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <SrTable caption="Hafta günü ortalama ciro" head={["Gün", "Gün sayısı", "Ortalama (₺)"]} rows={wd.map((w) => [w.label, w.days, fmt(w.avg)])} />
      {best ? (
        <p className="mt-3 text-xs text-muted-foreground">
          En güçlü gün <span className="font-medium text-foreground">{best.label}</span> · günlük ortalama {fmt(best.avg)} ₺
        </p>
      ) : null}
    </Panel>
  );
}

// ───────────────── Markalar ─────────────────
function Brands({ data, month, year }: { data: RevenueSummary; month: number; year: number }) {
  if (data.by_brand.length < 2) return null;
  const pm = prevMonthOf(year, month);
  const ranked = [...data.by_brand].sort((a, b) => b.total - a.total);
  return (
    <Panel title="Marka karşılaştırması" subtitle="Her markanın altında kendi mağazaları">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ranked.map((b) => {
          const maxStore = b.stores[0]?.total ?? 0;
          return (
            <div key={b.brand_id} className="relative overflow-hidden rounded-xl border border-border p-4 pl-5">
              <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: brandColor(b.brand_name) }} />
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Swatch color={brandColor(b.brand_name)} />
                {b.brand_name}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight">
                {fmt(b.total)} <span className="text-sm font-normal text-muted-foreground">₺</span>
              </div>
              <div className="text-xs tabular-nums text-muted-foreground">
                POS {fmtPct(pct(b.pos, b.total))} · nakit {fmtPct(pct(b.cash, b.total))} · cironun {fmtPct(pct(b.total, data.total))}&apos;i
              </div>
              <div className="mt-2">
                <Delta side={b.mom} label={`${MONTHS_SHORT[pm.m - 1]} ${pm.y}`} />
              </div>
              {b.stores.length > 0 ? (
                <ul className="mt-3 grid gap-2 border-t border-border pt-3">
                  {b.stores.map((s) => (
                    <li key={s.store_id}>
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="truncate">{s.store_name}</span>
                        <span className="shrink-0 font-medium tabular-nums">{fmt(s.total)} ₺</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${pct(s.total, maxStore)}%`, background: brandColor(b.brand_name) }} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ───────────────── Nakit oranı ─────────────────
function CashTrend({ data }: { data: RevenueSummary }) {
  const cr = data.cash_ratio_trend.filter((c) => c.total > 0);
  if (cr.length === 0) return null;
  const r = cr.map((c) => c.ratio * 100);
  let tone: "ok" | "warn" | "alert" = "ok";
  let msg = "Nakit oranı istikrarlı.";
  if (r.length === 3 && r[0]! > r[1]! && r[1]! > r[2]!) {
    const drop = r[0]! - r[2]!;
    if (drop >= 5) {
      tone = "alert";
      msg = `Nakit oranı 3 ay üst üste düşüyor (${drop.toFixed(1)} puan) — mağaza özetlerine yakından bakın.`;
    } else if (drop >= 2) {
      tone = "warn";
      msg = "Nakit oranında hafif düşüş eğilimi var.";
    }
  }
  return (
    <Panel title="Nakit oranı" subtitle="Toplam ciro içindeki nakit payı · veri olan son aylar">
      <div className="grid grid-cols-3 gap-2">
        {cr.map((c, i) => {
          const last = i === cr.length - 1;
          return (
            <div key={c.month_key} className={cn("rounded-xl border p-3 text-center", last ? "border-emerald-200 bg-emerald-50/60" : "border-transparent")}>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{c.label}</div>
              <div className={cn("mt-0.5 text-lg font-semibold tabular-nums", !last && "text-muted-foreground")}>{fmtPct(c.ratio * 100)}</div>
              <div aria-hidden className="mx-auto mt-1.5 h-1 w-16 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, c.ratio * 100)}%`, background: INK.cash }} />
              </div>
              <div className="text-[11px] tabular-nums text-muted-foreground">{fmt(c.cash)} ₺</div>
            </div>
          );
        })}
      </div>
      <p
        className={cn(
          "mt-3 flex items-center gap-1.5 text-xs",
          tone === "alert" ? "text-rose-700 dark:text-rose-400" : tone === "warn" ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground"
        )}
      >
        {tone !== "ok" ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
        {msg}
      </p>
    </Panel>
  );
}

// ───────────────── Günlük ─────────────────
function Daily({ data, month }: { data: RevenueSummary; month: number }) {
  const upTo = data.coverage.ongoing ? data.compare.window_end_day : data.daily_series.length;
  const rows = data.daily_series.slice(0, upTo).map((d) => ({ ...d, other: Math.max(0, d.total - d.cash - d.pos) }));
  const series = [
    { key: "pos", label: "POS / Kart", color: INK.pos },
    { key: "cash", label: "Nakit", color: INK.cash },
    { key: "other", label: "Diğer", color: INK.other },
  ] as const;
  return (
    <Panel title="Günlük görünüm" subtitle={`${MONTHS[month - 1]} boyunca gün gün ciro`}>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      <div aria-hidden className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 6, right: 0, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="day" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} minTickGap={0} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={fmtAxis} width={44} />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))" }}
              content={({ active, payload }) => {
                const d = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                if (!active || !d) return null;
                return (
                  <InkTooltip
                    title={`${d.day} ${MONTHS[month - 1]}`}
                    rows={series.filter((s) => d[s.key] > 0).map((s) => ({ label: s.label, value: d[s.key], color: s.color }))}
                    total={d.total}
                  />
                );
              }}
            />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="d"
                fill={s.color}
                stroke="hsl(var(--card))"
                strokeWidth={1}
                maxBarSize={22}
                radius={i === series.length - 1 ? [3, 3, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <SrTable
        caption={`${MONTHS[month - 1]} günlük ciro`}
        head={["Gün", "POS (₺)", "Nakit (₺)", "Diğer (₺)", "Toplam (₺)"]}
        rows={rows.map((d) => [d.day, fmt(d.pos), fmt(d.cash), fmt(d.other), fmt(d.total)])}
      />
    </Panel>
  );
}

// ───────────────── Bankalar ─────────────────
function Banks({ data }: { data: RevenueSummary }) {
  if (data.by_bank.length === 0) return null;
  const max = data.by_bank[0]?.total ?? 0;
  const total = data.bank_slips_total;
  const diff = total - data.pos;
  return (
    <Panel title="Banka bazında POS" subtitle="Yüklenen POS gün sonu fişlerinden · banka adları birleştirilmiş">
      <ol className="grid gap-3">
        {data.by_bank.map((b) => (
          <li key={b.bank_name}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">
                {b.bank_name}
                <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">{b.count} fiş</span>
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold">{fmt(b.total)} ₺</span>
                <span className="ml-2 inline-block w-12 text-right text-xs text-muted-foreground">{fmtPct(pct(b.total, total))}</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${Math.max(0.6, pct(b.total, max))}%`, background: INK.pos }} />
            </div>
            {b.parts ? (
              <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                Ortak kart ağı · {b.parts.map((p) => `${p.label} ${fmt(p.total)} ₺`).join(" · ")}
              </p>
            ) : null}
            {b.bank_name === "Bilinmeyen" ? <p className="mt-1 text-[11px] text-muted-foreground">Fişte banka adı okunamadı</p> : null}
          </li>
        ))}
      </ol>
      <dl className="mt-5 grid grid-cols-1 gap-2 border-t border-border pt-4 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">POS fişleri toplamı</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{fmt(total)} ₺</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Özetlerdeki kart toplamı</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{fmt(data.pos)} ₺</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Fark</dt>
          <dd className={cn("mt-0.5 font-semibold tabular-nums", Math.abs(diff) >= 1000 && "text-amber-800 dark:text-amber-300")}>
            {diff > 0 ? "+" : ""}
            {fmt(diff)} ₺
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

// ───────────────── Kök ─────────────────
export function RevenueDashboard({ brandId, storeId, year, month }: { brandId: string; storeId: string; year: number; month: number }) {
  const { data, isLoading } = trpc.analytics.revenue.useQuery({
    brand_id: brandId || undefined,
    store_id: storeId || undefined,
    year,
    month,
  });

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Yükleniyor">
        <ChartSkeleton height={200} />
        <StatCardSkeleton count={4} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartSkeleton height={220} />
          <ChartSkeleton height={220} />
        </div>
      </div>
    );
  }
  if (!data) return null;

  return <RevenueView data={data} year={year} month={month} />;
}

/** Saf görünüm — veri dışarıdan (önizleme ve test için ayrı). */
export function RevenueView({ data, year, month }: { data: RevenueSummary; year: number; month: number }) {
  if (data.total === 0 && data.active_days === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
        <Banknote className="mb-3 h-10 w-10 text-muted-foreground/60" aria-hidden />
        <div className="text-sm font-medium">Bu ay için gelir verisi yok</div>
        <p className="mt-1 text-xs text-muted-foreground">Mağaza gün sonu özeti yüklendikten sonra burada görünür.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4" style={VIZ_VARS}>
      <Hero data={data} month={month} year={year} />
      <Coverage data={data} month={month} />
      <Insights data={data} month={month} year={year} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Stores data={data} />
        <Banks data={data} />
      </div>
      <Daily data={data} month={month} />
      <Brands data={data} month={month} year={year} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Weekdays data={data} />
        <CashTrend data={data} />
      </div>
    </div>
  );
}
