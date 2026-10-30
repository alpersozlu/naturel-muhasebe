"use client";

import { AlertTriangle, Check, Download, Info, Loader2, Store, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { money } from "./format";
import { groupByStore, selectedItems, sumAmounts } from "./batch-select";

/**
 * Talimat / liste penceresinin GÖRÜNÜMÜ — saf bileşen, tüm durum ve işlemler
 * prop'tan gelir (kap: batch-dialog.tsx). Böylece önizlenebilir ve test edilir.
 *
 * Düzen (sahibi, 30.10.2026: "mağaza mağaza görmek beni rahatlatır", "görüntüsünü
 * beğenmedim"): üstte tarih + ödendi seçeneği + seçili toplam; gövdede mağaza
 * kartları (başlıkta toplu seçim, seçili/toplam kişi, ara toplam); her kartta
 * aynı sütun düzeninde kişi satırları; altta sabit özet + ana düğme.
 */
export type ViewRow = {
  line_id: string;
  full_name: string;
  bank_name: string;
  store_name: string;
  base: number;
  advances: number;
  extras: number;
  deductions: number;
  net_remaining: number;
  due: number;
  has_bank_details: boolean;
  note: string | null;
  for_next_month: boolean;
  pending_prepared: number;
  pending_note: string | null;
  kolayik_request?: number | null;
  kolayik_date?: string | null;
  kolayik_recorded?: number | null;
};

export type ViewChoice = { kind: "advance" | "payment1" | "payment2" | "single"; channel: "garanti" | "ziraat" | "cash" };

export type BatchDialogViewProps = {
  choice: ViewChoice;
  rows: ViewRow[] | null;
  prepareError: string | null;
  checked: Record<string, boolean>;
  amounts: Record<string, number | undefined>;
  payDate: string;
  markSent: boolean;
  storeOrder: string[];
  done: Record<string, { count: number; total: number }>;
  savingStore: string | null;
  busy: boolean;
  result: { file_name: string | null; file_base64: string | null; total: number; count: number } | null;
  onPayDate: (v: string) => void;
  onMarkSent: (v: boolean) => void;
  onToggle: (lineId: string, v: boolean) => void;
  onToggleMany: (lineIds: string[], v: boolean) => void;
  onAmount: (lineId: string, v: number | undefined) => void;
  onPayStore: (store: string) => void;
  onCreate: () => void;
  onClose: () => void;
  onDownloadAgain: () => void;
};

export function BatchDialogView(p: BatchDialogViewProps) {
  const { choice, rows, checked, amounts, done, storeOrder, result } = p;
  const isGaranti = choice.channel === "garanti";
  const isPayment2 = choice.kind === "payment2";
  const isAdvance = choice.kind === "advance";
  // Ödeme 2 nakit: mağaza mağaza kaydedilir (sahibi, 05.10.2026)
  const perStore = isPayment2 && choice.channel === "cash";

  const items = selectedItems(rows ?? [], checked, amounts);
  const total = sumAmounts(items);
  const groups = groupByStore(rows ?? [], storeOrder).filter((g) => g.rows.length > 0 || done[g.store]);
  const doneStores = storeOrder.filter((s) => done[s]);
  const doneCount = doneStores.reduce((s, k) => s + done[k]!.count, 0);
  const doneTotal = sumAmounts(doneStores.map((k) => ({ amount: done[k]!.total })));
  const missingBank = (rows ?? []).filter((r) => checked[r.line_id] && !r.has_bank_details).length;
  const allChecked = !!rows && rows.length > 0 && rows.every((r) => checked[r.line_id]);
  const someChecked = !!rows && rows.some((r) => checked[r.line_id]);

  const primaryLabel = isGaranti ? "Dosyayı oluştur ve indir" : perStore ? "Seçili herkesi ödendi olarak işle" : "Ödendi olarak işle";

  return (
    <div className="flex max-h-[inherit] flex-col">
      {/* Gövde — kaydırılır */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-4">
        {result ? (
          <ResultCard result={result} markSent={p.markSent} isGaranti={isGaranti} doneCount={doneCount} doneTotal={doneTotal} onDownloadAgain={p.onDownloadAgain} />
        ) : (
          <>
            {/* Üst çubuk: tarih · ödendi seçeneği · seçili toplam */}
            <div className="flex flex-wrap items-end gap-x-5 gap-y-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
              <div className="space-y-1">
                <Label htmlFor="batch-pay-date" className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Ödeme tarihi
                </Label>
                <Input id="batch-pay-date" type="date" value={p.payDate} onChange={(e) => p.onPayDate(e.target.value)} className="h-10 w-44 bg-white" />
              </div>
              {isGaranti ? (
                <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-slate-900" checked={p.markSent} onChange={(e) => p.onMarkSent(e.target.checked)} />
                  Hemen &quot;ödendi&quot; say
                </label>
              ) : (
                <span className="flex min-h-10 items-center text-xs text-muted-foreground">Kaydedilince ödendi sayılır</span>
              )}
              <div className="ml-auto text-right">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{perStore ? "Ödenecek" : "Seçili"}</div>
                <div className="text-lg font-semibold leading-tight tabular-nums">
                  {money(total)} ₺ <span className="text-sm font-normal text-muted-foreground">· {items.length} kişi</span>
                </div>
                {doneCount > 0 ? (
                  <div className="text-xs tabular-nums text-emerald-700">işlenen {doneCount} kişi · {money(doneTotal)} ₺</div>
                ) : null}
              </div>
            </div>

            {isAdvance ? (
              <Note tone="muted">Avans tutarlarını elle gir; netin %50&apos;sini geçenler işaretlenir.</Note>
            ) : null}
            {isPayment2 ? (
              <Note tone="muted">Ödeme 2 = mesai + komisyon + primler − kesintiler (kasa eksiği, fiyat farkı, faturasız masraf kişi penceresinden kesinti olarak girilir).</Note>
            ) : null}
            {missingBank > 0 && isGaranti ? (
              <Note tone="rose">{missingBank} kişinin şube/hesap bilgisi eksik — Personel sayfasından &quot;Hesapları talimattan aktar&quot; ile doldur.</Note>
            ) : null}

            {!rows ? (
              p.prepareError ? (
                <Note tone="rose">{p.prepareError}</Note>
              ) : (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Hazırlanıyor…
                </div>
              )
            ) : rows.length === 0 && doneCount > 0 ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-sm">
                <div className="flex items-center gap-2 font-medium text-emerald-800">
                  <Check className="h-4 w-4" aria-hidden /> Listedeki herkes ödendi olarak işlendi
                </div>
                <div className="mt-1 tabular-nums">
                  {doneCount} kişi · toplam <b>{money(doneTotal)} ₺</b>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {doneStores.map((s) => (
                    <span key={s} className="rounded-md bg-white px-2 py-1 tabular-nums ring-1 ring-emerald-200/70">
                      {s}: {done[s]!.count} kişi · {money(done[s]!.total)} ₺
                    </span>
                  ))}
                </div>
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                {isPayment2 ? "Ödeme 2'si bekleyen kimse yok." : "Bu kanal için ödenecek kimse yok."}
              </div>
            ) : (
              <>
                {/* Sütun başlığı — tüm mağaza kartlarında aynı düzen */}
                <div className={cn("grid grid-cols-[1.25rem_minmax(0,1fr)_8.5rem] items-center gap-x-3 px-4", isPayment2 ? COLS_P2 : COLS)}>
                  <label className="col-span-2 flex cursor-pointer items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-slate-900"
                      checked={allChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = !allChecked && someChecked;
                      }}
                      onChange={(e) => p.onToggleMany(rows.map((r) => r.line_id), e.target.checked)}
                      aria-label="Herkesi seç / bırak"
                    />
                    Herkes · {rows.length} kişi · {groups.length} mağaza
                  </label>
                  <ColumnHeads isPayment2={isPayment2} />
                </div>

                {groups.map((g) => {
                  const sel = selectedItems(g.rows, checked, amounts);
                  const gAll = g.rows.length > 0 && g.rows.every((r) => checked[r.line_id]);
                  const gSome = g.rows.some((r) => checked[r.line_id]);
                  return (
                    <section key={g.store} aria-label={g.store} className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-muted/40 px-3 py-2">
                        {g.rows.length > 0 ? (
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-slate-900"
                            aria-label={`${g.store}: hepsini seç / bırak`}
                            checked={gAll}
                            ref={(el) => {
                              if (el) el.indeterminate = !gAll && gSome;
                            }}
                            onChange={(e) => p.onToggleMany(g.rows.map((r) => r.line_id), e.target.checked)}
                          />
                        ) : (
                          <Store className="h-4 w-4 text-muted-foreground" aria-hidden />
                        )}
                        <span className="text-sm font-semibold">{g.store}</span>
                        {g.rows.length > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground ring-1 ring-border">
                            <Users className="h-3 w-3" aria-hidden />
                            {sel.length}
                            {sel.length !== g.rows.length ? ` / ${g.rows.length}` : ""} kişi
                          </span>
                        ) : null}
                        {done[g.store] ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-emerald-700 ring-1 ring-emerald-200/70">
                            <Check className="h-3 w-3" aria-hidden />
                            işlendi: {done[g.store]!.count} kişi · {money(done[g.store]!.total)} ₺
                          </span>
                        ) : null}
                        <span className="ml-auto text-sm font-semibold tabular-nums">{g.rows.length > 0 ? `${money(sumAmounts(sel))} ₺` : ""}</span>
                        {perStore && g.rows.length > 0 ? (
                          <Button size="sm" variant="secondary" className="h-8" onClick={() => p.onPayStore(g.store)} disabled={p.busy || sel.length === 0}>
                            {p.savingStore === g.store ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                            {p.savingStore === g.store ? "Kaydediliyor…" : "Bu mağaza ödendi"}
                          </Button>
                        ) : null}
                      </header>
                      <div className="divide-y divide-border/70">
                        {g.rows.map((r) => (
                          <PersonRow
                            key={r.line_id}
                            r={r}
                            checked={!!checked[r.line_id]}
                            amount={amounts[r.line_id]}
                            isGaranti={isGaranti}
                            isPayment2={isPayment2}
                            isAdvance={isAdvance}
                            onToggle={(v) => p.onToggle(r.line_id, v)}
                            onAmount={(v) => p.onAmount(r.line_id, v)}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>

      {/* Alt çubuk — sabit */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-background px-6 py-3">
        {!result && rows && rows.length > 0 ? (
          <div className="text-sm tabular-nums">
            <span className="text-muted-foreground">Seçili </span>
            <b>{items.length} kişi</b>
            <span className="text-muted-foreground"> · </span>
            <b>{money(total)} ₺</b>
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={p.onClose}>
            {result || doneCount > 0 ? "Kapat" : "Vazgeç"}
          </Button>
          {!result && !(rows && rows.length === 0) ? (
            <Button onClick={p.onCreate} disabled={p.busy || items.length === 0} className="min-w-44">
              {p.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : isGaranti ? <Download className="mr-2 h-4 w-4" aria-hidden /> : <Check className="mr-2 h-4 w-4" aria-hidden />}
              {primaryLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Sütun düzeni: ad esnek, sayılar 6,5rem, tutar 9rem — kartlarda aynı. */
const COLS = "sm:grid-cols-[1.25rem_minmax(11rem,1fr)_6rem_6rem_6rem_6.5rem_8.5rem]";
const COLS_P2 = "sm:grid-cols-[1.25rem_minmax(11rem,1fr)_6rem_6rem_6.5rem_8.5rem]";

function ColumnHeads({ isPayment2 }: { isPayment2: boolean }) {
  const H = ({ children }: { children: React.ReactNode }) => (
    <span className="hidden text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:block">{children}</span>
  );
  return (
    <>
      <H>{isPayment2 ? "Ekstra" : "Baz"}</H>
      {!isPayment2 ? <H>Avans</H> : null}
      <H>Kesinti</H>
      <H>Net kalan</H>
      <span className="pr-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tutar</span>
    </>
  );
}

function PersonRow({
  r,
  checked,
  amount,
  isGaranti,
  isPayment2,
  isAdvance,
  onToggle,
  onAmount,
}: {
  r: ViewRow;
  checked: boolean;
  amount: number | undefined;
  isGaranti: boolean;
  isPayment2: boolean;
  isAdvance: boolean;
  onToggle: (v: boolean) => void;
  onAmount: (v: number | undefined) => void;
}) {
  const a = amount ?? 0;
  const high = isAdvance && a > r.base * 0.5;
  const meta = [isGaranti ? r.bank_name : null, r.for_next_month ? "gelecek ayın maaşı" : null].filter(Boolean).join(" · ");
  const kolayDiff = isAdvance && r.kolayik_request != null && amount != null && Math.abs((amount ?? 0) - r.kolayik_request) > 0.5;
  return (
    <div className={cn("grid grid-cols-[1.25rem_minmax(0,1fr)_8.5rem] items-center gap-x-3 px-3 py-2", isPayment2 ? COLS_P2 : COLS, !checked && "opacity-50")}>
      <input type="checkbox" className="h-4 w-4 accent-slate-900" checked={checked} onChange={(e) => onToggle(e.target.checked)} aria-label={r.full_name} />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{r.full_name}</div>
        {meta ? <div className="truncate text-[11px] text-muted-foreground">{meta}</div> : null}
        {!r.has_bank_details && isGaranti ? (
          <div className="flex items-center gap-1 text-[11px] text-rose-700">
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> şube/hesap bilgisi eksik
          </div>
        ) : null}
        {r.note ? (
          <div className="flex items-start gap-1 text-[11px] text-amber-800">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> <span>{r.note}</span>
          </div>
        ) : null}
        {r.pending_note ? (
          <div className="flex items-start gap-1 text-[11px] text-rose-700">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> <span>{r.pending_note}</span>
          </div>
        ) : null}
        {isAdvance && r.kolayik_request != null ? (
          <div className={cn("text-[11px]", kolayDiff ? "text-amber-800" : "text-sky-800")}>
            Kolay İK talebi {money(r.kolayik_request)}
            {r.kolayik_date ? ` · ${r.kolayik_date.split("-").reverse().join(".")}` : ""}
            {kolayDiff ? ` → ${money(amount!)} ödenecek (farklı tutar)` : ""}
            {r.kolayik_recorded != null ? ` · bordroda zaten ${money(r.kolayik_recorded)} avans var` : ""}
          </div>
        ) : null}
        {/* Mobil: sayılar adın altında */}
        <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-muted-foreground sm:hidden">
          <span>{isPayment2 ? "Ekstra" : "Baz"} {money(isPayment2 ? r.extras : r.base)}</span>
          {!isPayment2 && r.advances ? <span className="text-amber-800">Avans {money(r.advances)}</span> : null}
          {r.deductions ? <span className="text-rose-700">Kesinti −{money(r.deductions)}</span> : null}
          <span className="text-foreground">Net {money(r.net_remaining)}</span>
        </div>
      </div>
      <Num className="hidden sm:block">{money(isPayment2 ? r.extras : r.base)}</Num>
      {!isPayment2 ? <Num className={cn("hidden sm:block", r.advances && "text-amber-800")}>{r.advances ? money(r.advances) : "—"}</Num> : null}
      <Num className={cn("hidden sm:block", r.deductions && "text-rose-700")}>{r.deductions ? `−${money(r.deductions)}` : "—"}</Num>
      <Num className="hidden font-semibold text-foreground sm:block">{money(r.net_remaining)}</Num>
      <div className="justify-self-end">
        <MoneyInput value={amount} onChange={onAmount} className={cn("h-9 w-32 text-right", high && "border-rose-400 focus-visible:ring-rose-400")} disabled={!checked} aria-label={`${r.full_name} tutar`} />
        {high ? <div className="mt-0.5 text-right text-[10px] text-rose-700">netin %50&apos;sinden fazla</div> : null}
      </div>
    </div>
  );
}

function Num({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("text-right text-sm tabular-nums text-muted-foreground", className)}>{children}</div>;
}

function Note({ tone, children }: { tone: "muted" | "rose"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-relaxed",
        tone === "rose" ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200/70" : "bg-muted/40 text-muted-foreground"
      )}
      role={tone === "rose" ? "alert" : undefined}
    >
      {tone === "rose" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
      <span>{children}</span>
    </div>
  );
}

function ResultCard({
  result,
  markSent,
  isGaranti,
  doneCount,
  doneTotal,
  onDownloadAgain,
}: {
  result: NonNullable<BatchDialogViewProps["result"]>;
  markSent: boolean;
  isGaranti: boolean;
  doneCount: number;
  doneTotal: number;
  onDownloadAgain: () => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-sm">
      <div className="flex items-center gap-2 font-medium text-emerald-800">
        <Check className="h-4 w-4" aria-hidden />
        {result.file_name ? `Hazırlandı: ${result.file_name}` : "Ödendi olarak işlendi"}
      </div>
      <div className="tabular-nums">
        {result.count} kişi · toplam <b>{money(result.total)} ₺</b>
      </div>
      <p className="text-xs leading-relaxed text-emerald-900/80">
        {markSent
          ? "Ödendi olarak işlendi."
          : isGaranti
            ? "Dosyayı Garanti'ye e-posta ile gönderin; ödeme gerçekleşince talimatlar listesinde \"Gönderildi / ödendi\" işaretleyin."
            : "Ödeme yapılınca talimatlar listesinde \"Gönderildi / ödendi\" işaretleyin."}
      </p>
      {doneCount > 0 ? (
        <div className="text-xs text-muted-foreground tabular-nums">Bu pencerede daha önce mağaza mağaza işlenen: {doneCount} kişi · {money(doneTotal)} ₺</div>
      ) : null}
      {result.file_base64 && result.file_name ? (
        <Button variant="outline" size="sm" onClick={onDownloadAgain}>
          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          Tekrar indir
        </Button>
      ) : null}
    </div>
  );
}
