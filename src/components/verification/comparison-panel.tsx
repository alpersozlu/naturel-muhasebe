"use client";

import {
  Check,
  AlertTriangle,
  AlertCircle,
  Radio,
  ShieldCheck,
  ShieldAlert,
  Banknote,
  CreditCard,
} from "lucide-react";
import { fmt } from "./types";

/**
 * Günün mutabakat dökümü (Doğrulama Sistemi, gün kartı açılınca):
 * belge ↔ mağaza özeti karşılaştırma tablosu, özetin kendi içi, Nebim
 * server kıyası (Derimod), açıklama notları. verification.preview sonucunu alır.
 */
export function ComparisonPanel({
  result,
}: {
  result: {
    rows: Array<{
      label: string;
      document_total: number;
      summary_total: number;
      difference: number;
      matches: boolean;
      z_compliance?: { cash_present: boolean; hard_floor?: number };
    }>;
    status: "match" | "mismatch" | "no_data" | "no_summary";
    notes: string | null;
    summary_parts?: {
      sales: number;
      cash: number;
      card: number;
      loyalty: number;
      shopping_voucher: number;
      wire: number;
      other: number;
    };
    nebim_summary?: {
      net: number;
      sales: number;
      returns: number;
      line_count: number;
      invoice_count: number;
      summary_sales: number;
      difference: number;
      payment?: NebimPayment | null;
      card_by_bank?: NebimBankCompare[] | null;
    } | null;
  };
}) {
  if (result.status === "no_summary") {
    return (
      <div className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-3 flex items-start gap-2 border border-amber-200/60">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        Bu güne ait Mağaza Özeti yüklenmedi — mutabakat yapılamıyor.
      </div>
    );
  }
  if (result.status === "no_data") {
    return (
      <div className="text-sm text-muted-foreground">Bu gün için kayıt yok.</div>
    );
  }

  // Açıklama notlarını parçala (cümle bazlı) — her biri ayrı pill
  const noteList = result.notes
    ? result.notes
        .split(/(?<=\.)\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return (
    <div>
      {/* Tablo */}
      <div className="rounded-xl border border-border/70 overflow-hidden bg-card">
        <div className="grid grid-cols-12 gap-2 px-5 py-2.5 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          <div className="col-span-4">Belge Türü</div>
          <div className="col-span-3 text-right">Belge Tutarı</div>
          <div className="col-span-2 text-right">Mağaza Özeti</div>
          <div className="col-span-2 text-right">Fark</div>
          <div className="col-span-1 text-right">Durum</div>
        </div>
        <div>
          {result.rows
            .filter((r) => !(r.label === "Kartuş Puan" && Math.abs(r.document_total) < 0.005 && Math.abs(r.summary_total) < 0.005))
            .map((row, i, rows) => {
            const isLast = i === rows.length - 1;
            // The Z row is not compared with the summary: its right-hand
            // figure is the bar the Z must reach (card sales, ×1,05 when the
            // day has cash). Say so, or it reads as a summary number.
            const z = row.z_compliance;
            return (
              <div
                key={row.label}
                className={`grid grid-cols-12 gap-2 px-5 py-3 items-baseline ${
                  isLast
                    ? "border-t-2 border-border bg-slate-50/40 font-semibold"
                    : i === 0
                      ? ""
                      : "border-t border-border/40"
                }`}
              >
                <div className="col-span-4 text-sm text-foreground">
                  {row.label}
                  {z ? (
                    <div className="text-[11px] font-normal text-muted-foreground mt-0.5">
                      Özetle kıyas değil — Z'nin ulaşması gereken hedef
                    </div>
                  ) : null}
                </div>
                <div className="col-span-3 text-right text-sm tabular-nums text-foreground">
                  {fmt(row.document_total)} ₺
                </div>
                <div className="col-span-2 text-right text-sm tabular-nums text-muted-foreground">
                  {z ? "≥ " : ""}
                  {fmt(row.summary_total)} ₺
                  {z ? (
                    <div className="text-[11px] opacity-80">
                      {z.cash_present ? "hedef: kart × 1,05" : "hedef: kart"}
                    </div>
                  ) : null}
                </div>
                <div className="col-span-2 text-right text-sm tabular-nums">
                  <FarkCell diff={row.difference} matches={row.matches} />
                </div>
                <div className="col-span-1 text-right">
                  {row.matches ? (
                    <Check
                      className="h-4 w-4 text-emerald-600 inline"
                      aria-label="Eşleşti"
                    />
                  ) : (
                    <AlertTriangle
                      className="h-4 w-4 text-rose-600 inline"
                      aria-label="Eşleşmiyor"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {result.summary_parts ? <SummaryParts p={result.summary_parts} /> : null}

      {/* NEBİM canlı server karşılaştırması (3. kontrol — Derimod) */}
      {result.nebim_summary ? <NebimBlock n={result.nebim_summary} /> : null}

      {/* Açıklama notları — varsa */}
      {noteList.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {noteList.map((note, i) => (
            <NoteCard key={i} text={note} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The store summary's own lines, so the "Mağaza Özeti" column can be read:
 * cash + card (+ …) = sales. A remainder is shown as its own term; a large
 * one means a summary line was misread (Kredi Çeki is at most a few thousand).
 */
function SummaryParts({
  p,
}: {
  p: {
    sales: number;
    cash: number;
    card: number;
    loyalty: number;
    shopping_voucher: number;
    wire: number;
    other: number;
  };
}) {
  const terms: Array<[string, number]> = [
    ["Nakit", p.cash],
    ["Kredi Kartı", p.card],
  ];
  if (Math.abs(p.loyalty) > 0.005) terms.push(["Kartuş", p.loyalty]);
  if (Math.abs(p.shopping_voucher) > 0.005) terms.push(["Alışveriş Çeki", p.shopping_voucher]);
  if (Math.abs(p.wire) > 0.005) terms.push(["Havale", p.wire]);
  const hasOther = Math.abs(p.other) > 1;
  const otherIsLarge = Math.abs(p.other) > Math.max(5000, Math.abs(p.sales) * 0.1);
  return (
    <div
      className={`mt-3 rounded-lg px-4 py-2.5 text-xs tabular-nums ${
        otherIsLarge
          ? "bg-amber-50 text-amber-800 border border-amber-200/70"
          : "bg-muted/30 text-muted-foreground"
      }`}
    >
      <span className="font-medium text-foreground/80">Mağaza özeti kendi içinde: </span>
      {terms.map(([label, v], i) => (
        <span key={label}>
          {i > 0 ? (v < 0 ? " − " : " + ") : ""}
          {label} {fmt(i > 0 ? Math.abs(v) : v)}
        </span>
      ))}
      {hasOther ? (
        <span className={otherIsLarge ? "font-semibold" : ""}>
          {p.other < 0 ? " − " : " + "}Kredi Çeki / diğer {fmt(Math.abs(p.other))}
        </span>
      ) : null}
      <span> = Satış {fmt(p.sales)} ₺</span>
      {otherIsLarge ? (
        <div className="mt-1">
          Özetteki ödeme satırları satış toplamını ancak {fmt(Math.abs(p.other))} ₺&apos;lik
          açıklanamayan bir kalemle tutuyor — özetin bir satırı yanlış okunmuş olabilir.
          Özeti &quot;Yeniden analiz et&quot; ile tekrar okutun.
        </div>
      ) : null}
    </div>
  );
}

/**
 * NEBİM canlı server karşılaştırması (Derimod 3. kontrol aşaması).
 * Günün Nebim net satış toplamı (iade düşülü) ↔ Mağaza Özeti satış toplamı.
 * "Server'da gerçekten o kadar satış oldu mu" kontrolü.
 * difference = Nebim net − Mağaza Özeti:
 *  > 0 → server > özet → ÖZET AZ (kritik) · < 0 → server < özet → ÖZET FAZLA (anomali)
 */
type NebimPayment = {
  nebim_cash: number;
  nebim_card: number;
  summary_cash: number;
  summary_card: number;
  cash_diff: number;
  card_diff: number;
};

type NebimBankCompare = {
  bank: string;
  nebim: number;
  slip: number;
  slip_count: number;
  diff: number;
};

function NebimBlock({
  n,
}: {
  n: {
    net: number;
    sales: number;
    returns: number;
    line_count: number;
    invoice_count: number;
    summary_sales: number;
    difference: number;
    payment?: NebimPayment | null;
    card_by_bank?: NebimBankCompare[] | null;
  };
}) {
  const matches = Math.abs(n.difference) <= 1;
  const tone = matches
    ? {
        bar: "border-emerald-200 bg-gradient-to-r from-emerald-50 to-white",
        accent: "text-emerald-600",
        title: "text-emerald-900",
        Icon: ShieldCheck,
        label: "Server ile uyumlu",
        explainer: "Mağaza Özeti, server'daki gerçek satışla tutuyor.",
      }
    : n.difference > 0
      ? {
          bar: "border-rose-300 bg-gradient-to-r from-rose-50 to-rose-50/40",
          accent: "text-rose-600",
          title: "text-rose-900",
          Icon: ShieldAlert,
          label: "Özet, server'dan AZ",
          explainer:
            "Nebim server'da bu günün satışı Mağaza Özeti'nden yüksek — özette daha az satış gösterilmiş olabilir.",
        }
      : {
          bar: "border-amber-300 bg-gradient-to-r from-amber-50 to-amber-50/40",
          accent: "text-amber-600",
          title: "text-amber-900",
          Icon: AlertTriangle,
          label: "Özet, server'dan FAZLA",
          explainer:
            "Mağaza Özeti server'daki satıştan yüksek — server'a henüz işlenmemiş satış olabilir, kontrol et.",
        };
  const Icon = tone.Icon;

  return (
    <div className={`mt-4 rounded-2xl border-2 ${tone.bar} p-4 shadow-sm`}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 ${tone.accent}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-semibold text-sm ${tone.title} flex items-center gap-2 flex-wrap`}>
            Nebim Server Karşılaştırması — {tone.label}
            <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded-full bg-slate-900/5 px-2 py-0.5 text-slate-600">
              <Radio className="h-3 w-3" /> canlı · 3. kontrol
            </span>
          </div>
          <div className="text-xs text-foreground/80 mt-1">{tone.explainer}</div>

          <div className="grid grid-cols-3 gap-2 mt-3">
            <div className="rounded-lg bg-white/70 border border-border/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Server Net Satış
              </div>
              <div className="tabular-nums font-semibold text-sm">{fmt(n.net)} ₺</div>
            </div>
            <div className="rounded-lg bg-white/70 border border-border/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Mağaza Özeti
              </div>
              <div className="tabular-nums font-semibold text-sm">
                {fmt(n.summary_sales)} ₺
              </div>
            </div>
            <div className="rounded-lg bg-white/70 border border-border/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Fark
              </div>
              <div className={`tabular-nums font-semibold text-sm ${tone.accent}`}>
                {n.difference >= 0 ? "+" : ""}
                {fmt(n.difference)} ₺
              </div>
            </div>
          </div>

          <div className="text-[11px] text-muted-foreground mt-2">
            {n.invoice_count} fiş · {n.line_count} satır
            {n.returns < 0 ? ` · iade düşülü ${fmt(Math.abs(n.returns))} ₺` : ""}
          </div>

          {/* Ödeme tipi kıyası — Nebim nakit/kart ↔ Mağaza Özeti (brüt satış) */}
          {n.payment ? (
            <div className="mt-3 rounded-xl border border-border/60 bg-white/70 overflow-hidden">
              <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-slate-900/[0.04] text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                <div className="col-span-4">Ödeme Tipi (brüt)</div>
                <div className="col-span-3 text-right">Nebim</div>
                <div className="col-span-3 text-right">Mağaza Özeti</div>
                <div className="col-span-2 text-right">Fark</div>
              </div>
              <PayCompareRow
                label="Nakit"
                Icon={Banknote}
                iconClass="text-emerald-600"
                nebim={n.payment.nebim_cash}
                summary={n.payment.summary_cash}
                diff={n.payment.cash_diff}
              />
              <PayCompareRow
                label="Kredi Kartı"
                Icon={CreditCard}
                iconClass="text-indigo-600"
                nebim={n.payment.nebim_card}
                summary={n.payment.summary_card}
                diff={n.payment.card_diff}
                border
              />
            </div>
          ) : null}

          {/* Kart — Banka bazında ↔ POS slipleri (çalışan doğru girdi mi?) */}
          {n.card_by_bank && n.card_by_bank.length > 0 ? (
            <div className="mt-3 rounded-xl border border-border/60 bg-white/70 overflow-hidden">
              <div className="px-3 py-1.5 bg-slate-900/[0.04] flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5 text-indigo-600" />
                <span className="text-[11px] font-semibold text-foreground/80">
                  Kart — Banka Bazında ↔ POS Slipleri
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Nebim&apos;e doğru banka girilmiş mi?
                </span>
              </div>
              <div className="grid grid-cols-12 gap-2 px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground font-medium border-b border-border/40">
                <div className="col-span-4">Banka (Nebim kartı)</div>
                <div className="col-span-3 text-right">Nebim</div>
                <div className="col-span-3 text-right">POS Slip</div>
                <div className="col-span-2 text-right">Fark</div>
              </div>
              {n.card_by_bank.map((b, i) => (
                <BankSlipRow key={b.bank} b={b} border={i > 0} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function BankSlipRow({ b, border }: { b: NebimBankCompare; border?: boolean }) {
  const noSlip = b.slip_count === 0 && b.slip === 0;
  const matches = Math.abs(b.diff) <= 1;
  return (
    <div
      className={`grid grid-cols-12 gap-2 px-3 py-2 items-center text-sm ${
        border ? "border-t border-border/40" : ""
      }`}
    >
      <div className="col-span-4 font-medium truncate">{b.bank}</div>
      <div className="col-span-3 text-right tabular-nums">{fmt(b.nebim)} ₺</div>
      <div className="col-span-3 text-right tabular-nums text-muted-foreground">
        {noSlip ? "—" : `${fmt(b.slip)} ₺`}
        {b.slip_count > 0 ? (
          <span className="text-[10px] text-muted-foreground/70"> ({b.slip_count})</span>
        ) : null}
      </div>
      <div className="col-span-2 text-right tabular-nums flex items-center justify-end gap-1">
        {noSlip ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600">
            <AlertCircle className="h-3.5 w-3.5" /> slip yok
          </span>
        ) : (
          <>
            <span className={matches ? "text-emerald-600" : "text-rose-600 font-medium"}>
              {b.diff >= 0 ? "+" : ""}
              {fmt(b.diff)}
            </span>
            {matches ? (
              <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PayCompareRow({
  label,
  Icon,
  iconClass,
  nebim,
  summary,
  diff,
  border,
}: {
  label: string;
  Icon: typeof Banknote;
  iconClass: string;
  nebim: number;
  summary: number;
  diff: number;
  border?: boolean;
}) {
  const matches = Math.abs(diff) <= 1;
  return (
    <div
      className={`grid grid-cols-12 gap-2 px-3 py-2 items-center text-sm ${
        border ? "border-t border-border/40" : ""
      }`}
    >
      <div className="col-span-4 flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${iconClass}`} />
        <span className="font-medium">{label}</span>
      </div>
      <div className="col-span-3 text-right tabular-nums">{fmt(nebim)} ₺</div>
      <div className="col-span-3 text-right tabular-nums text-muted-foreground">
        {fmt(summary)} ₺
      </div>
      <div className="col-span-2 text-right tabular-nums flex items-center justify-end gap-1">
        <span className={matches ? "text-emerald-600" : "text-rose-600 font-medium"}>
          {diff >= 0 ? "+" : ""}
          {fmt(diff)}
        </span>
        {matches ? (
          <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
        )}
      </div>
    </div>
  );
}

export function FarkCell({ diff, matches }: { diff: number; matches: boolean }) {
  // Konvansiyon: docs − summary
  //   pozitif → elimizdeki belge özetten fazla (fazla)
  //   negatif → belge özetten az (eksik)
  //   |diff| ≤ tolerans (matches=true) → 0,00 (yeşil, eşleşti)
  if (Math.abs(diff) < 0.01) {
    return <span className="text-emerald-600">0,00 ₺</span>;
  }
  if (matches) {
    // Tolerans içinde ama sıfır değil — yeşil ama "minor"
    const positive = diff > 0;
    return (
      <span className="text-emerald-600 font-medium">
        {positive ? "+" : ""}
        {fmt(diff)} ₺
      </span>
    );
  }
  // Tolerans dışı: pozitif = fazla (amber), negatif = eksik (rose)
  const positive = diff > 0;
  const tone = positive ? "text-amber-700" : "text-rose-700";
  return (
    <span className={`${tone} font-medium`}>
      {positive ? "+" : ""}
      {fmt(diff)} ₺
    </span>
  );
}

function NoteCard({ text }: { text: string }) {
  // İlk iki kelimeyi başlık olarak gösterelim ("Kasa eksiklik:", "Kasa fazlalık:")
  const colonIdx = text.indexOf(":");
  const label = colonIdx > 0 ? text.slice(0, colonIdx) : null;
  const body = colonIdx > 0 ? text.slice(colonIdx + 1).trim() : text;

  // Eksik = kırmızı; Fazla = amber; diğer = rose (default)
  const isDeficit = /eksik/i.test(label ?? "");
  const tone = isDeficit
    ? "bg-rose-50 border-rose-200 text-rose-800"
    : "bg-amber-50 border-amber-200 text-amber-800";

  return (
    <div
      className={`text-sm rounded-lg border px-4 py-2.5 flex items-start gap-2.5 ${tone}`}
    >
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 opacity-80" />
      <div className="leading-relaxed">
        {label ? <span className="font-semibold">{label}:</span> : null}{" "}
        <span>{body}</span>
      </div>
    </div>
  );
}
