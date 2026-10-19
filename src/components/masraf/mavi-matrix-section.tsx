"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Table2, Pencil, ListChecks, Check, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/ui/money-input";
import { CashItemsDialog } from "./cash-items-dialog";

/**
 * MASRAF MATRİSİ — sahibinin "Mavi Masraflar" Excel'i ekranda: grup başlıkları
 * (KİRA / PERSONEL / DİĞER GİDERLER / OFİS) + alt satırlar × mağazalar. Ay
 * seçiliyken her hücre tıklanıp ELLE tutar girilebilir (SSK, yol, elektrik,
 * ofis…); otomatik kaynaklar (şirket faturası ÷7, kasa, POS %5, defolu, bordro)
 * hücrede toplanır ve kaynak rozetiyle görünür.
 */

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SOURCE_META: Record<string, { label: string; cls: string }> = {
  invoiced: { label: "Şirket ÷7", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  cash: { label: "Kasa", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  pos: { label: "POS %5", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  defolu: { label: "Defolu", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  payroll: { label: "Bordro", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  manual: { label: "Elle", cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

function triggerXlsxDownload(base64: string, filename: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type BrandKey = "mavi" | "derimod";

export function MaviMatrixSection({ year, month, brand }: { year: number; month: number; brand: BrandKey }) {
  const utils = trpc.useUtils();
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [edit, setEdit] = useState<{ row: string; code: string } | null>(null);
  const [editVal, setEditVal] = useState<number | undefined>(undefined);

  const { data: report, isLoading } = trpc.invoicedExpense.report.useQuery({ year, brand });
  const exportXlsx = trpc.invoicedExpense.exportMatrix.useMutation();
  const manualSet = trpc.invoicedExpense.manualSet.useMutation({
    onSuccess: () => {
      void utils.invoicedExpense.report.invalidate({ year, brand });
      setEdit(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleExcel = async () => {
    setXlsxLoading(true);
    try {
      const { base64, filename } = await exportXlsx.mutateAsync({ year, brand });
      triggerXlsxDownload(base64, filename);
      toast.success("Excel indirildi (tüm yıl — sahibinin düzeni)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Excel oluşturulamadı");
    } finally {
      setXlsxLoading(false);
    }
  };

  type Row = NonNullable<typeof report>["rows"][number];
  const cellOf = (r: Row, code: string) => (month === 0 ? null : r.cells[month]?.[code] ?? null);
  const cellValue = (r: Row, code: string): number => (month === 0 ? r.storeTotals[code] ?? 0 : cellOf(r, code)?.total ?? 0);
  const rowValue = (r: Row): number => (month === 0 ? r.rowTotal : (report?.storeCodes ?? []).reduce((s, c) => s + cellValue(r, c), 0));
  const rowSources = (r: Row): string[] => {
    if (month === 0) return r.sources;
    const byStore = r.cells[month];
    if (!byStore) return [];
    const acc = new Set<string>();
    for (const cell of Object.values(byStore)) for (const s of Object.keys(SOURCE_META)) if ((cell as Record<string, number>)[s]) acc.add(s);
    return Object.keys(SOURCE_META).filter((s) => acc.has(s));
  };
  const groupValue = (g: NonNullable<typeof report>["groups"][number], code: string): number => (month === 0 ? g.storeTotals[code] ?? 0 : g.cells[month]?.[code] ?? 0);
  const groupTotal = (g: NonNullable<typeof report>["groups"][number]): number => (month === 0 ? g.groupTotal : (report?.storeCodes ?? []).reduce((s, c) => s + groupValue(g, c), 0));
  const colTotal = (code: string): number => (!report ? 0 : month === 0 ? report.storeTotals[code] ?? 0 : report.columnTotals[month]?.[code] ?? 0);
  const grandTotal = useMemo(() => (!report ? 0 : month === 0 ? report.grandTotal : report.monthTotals[month] ?? 0), [report, month]);
  const codes = report?.storeCodes ?? [];
  const payrollOk = month !== 0 && (report?.payrollMonths ?? []).includes(month);

  const startEdit = (r: Row, code: string) => {
    if (month === 0) {
      toast.info("Elle giriş için bir ay seç.");
      return;
    }
    const c = cellOf(r, code);
    setEdit({ row: r.key, code });
    setEditVal(c?.manual ? Math.round(c.manual * 100) / 100 : undefined);
  };
  const saveEdit = () => {
    if (!edit) return;
    manualSet.mutate({ brand, year, month, store_code: edit.code, row_key: edit.row, amount_try: editVal ?? 0 });
  };

  return (
    <Card className="mt-6">
      <CardContent className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Table2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold leading-tight">{report?.title ?? "Masraf Matrisi"} — {month === 0 ? `${year} tüm yıl` : `${MONTHS[month - 1]} ${year}`}</h2>
              <p className="text-xs text-muted-foreground">
                Şirket faturası ÷{report?.store_count ?? 7} · kasa · POS %5 · defolu · bordro · elle. {month === 0 ? "Elle giriş için ay seç." : "Hücreye tıkla → elle tutar gir."}
                {month !== 0 && !payrollOk ? " Bu ayın bordrosu henüz yok (Çalışma Ücreti / Prim / Mesai boş)." : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={month === 0} onClick={() => setCashOpen(true)} title="Mağaza fişleri + faturasız ödemeler; satır düzeltme">
              <ListChecks className="mr-1.5 h-4 w-4" /> Kasa kalemleri
            </Button>
            <Button variant="outline" size="sm" disabled={xlsxLoading} onClick={handleExcel}>
              {xlsxLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
              Excel İndir
            </Button>
          </div>
        </div>

        {isLoading || !report ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Yükleniyor…</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left font-medium">Kategori</th>
                  {codes.map((c) => (
                    <th key={c} className="whitespace-nowrap px-3 py-2 text-right font-medium">{c} {report.storeNames[c]}</th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">{month === 0 ? "Yıl Toplam" : "Ay Toplam"}</th>
                  <th className="px-3 py-2 text-left font-medium">Kaynak</th>
                </tr>
              </thead>
              <tbody>
                {report.groups.map((g) => {
                  const rows = report.rows.filter((r) => r.group === g.key);
                  return [
                    <tr key={`g-${g.key}`} className="border-t-2 border-primary/30 bg-primary/5 font-semibold">
                      <td className="sticky left-0 z-10 bg-primary/5 px-3 py-2">{g.label}</td>
                      {codes.map((c) => (
                        <td key={c} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{groupValue(g, c) === 0 ? "·" : fmt(groupValue(g, c))}</td>
                      ))}
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-primary">{groupTotal(g) === 0 ? "·" : fmt(groupTotal(g))}</td>
                      <td />
                    </tr>,
                    ...rows.map((r) => {
                      const rTotal = rowValue(r);
                      const srcs = rowSources(r);
                      return (
                        <tr key={r.key} className="border-t border-border/40">
                          <td className="sticky left-0 z-10 bg-background px-3 py-1.5 pl-6" title={r.note ?? undefined}>
                            <span className={r.auto || r.hasData ? "" : "text-muted-foreground"}>{r.label}</span>
                          </td>
                          {codes.map((c) => {
                            const v = cellValue(r, c);
                            const cell = cellOf(r, c);
                            const isEdit = edit?.row === r.key && edit.code === c;
                            return (
                              <td key={c} className={cn("whitespace-nowrap px-2 py-1 text-right tabular-nums", v === 0 && "text-muted-foreground/40")}>
                                {isEdit ? (
                                  <span className="inline-flex items-center gap-1">
                                    <MoneyInput
                                      autoFocus
                                      className="h-7 w-28 text-right text-xs"
                                      value={editVal}
                                      onChange={setEditVal}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") saveEdit();
                                        if (e.key === "Escape") setEdit(null);
                                      }}
                                    />
                                    <button type="button" className="text-emerald-700" onClick={saveEdit} disabled={manualSet.isPending} title="Kaydet"><Check className="h-4 w-4" /></button>
                                    <button type="button" className="text-muted-foreground" onClick={() => setEdit(null)} title="Vazgeç"><X className="h-4 w-4" /></button>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className={cn("group inline-flex w-full items-center justify-end gap-1 rounded px-1 py-0.5 hover:bg-accent/60", month === 0 && "cursor-default hover:bg-transparent")}
                                    onClick={() => startEdit(r, c)}
                                    title={
                                      cell
                                        ? Object.keys(SOURCE_META)
                                            .filter((s) => (cell as Record<string, number>)[s])
                                            .map((s) => `${SOURCE_META[s]!.label}: ${fmt((cell as Record<string, number>)[s]!)}`)
                                            .join(" · ")
                                        : month === 0 ? undefined : "elle tutar gir"
                                    }
                                  >
                                    <span>{v === 0 ? "·" : fmt(v)}</span>
                                    {month !== 0 ? <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" /> : null}
                                  </button>
                                )}
                              </td>
                            );
                          })}
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-medium">{rTotal === 0 ? "·" : fmt(rTotal)}</td>
                          <td className="px-3 py-1.5">
                            {srcs.length === 0 ? (
                              <span className="text-[10px] text-muted-foreground">{r.auto ? "veri yok" : "elle"}</span>
                            ) : (
                              <span className="inline-flex flex-wrap gap-1">
                                {srcs.map((s) => (
                                  <span key={s} className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", SOURCE_META[s]?.cls)}>{SOURCE_META[s]?.label ?? s}</span>
                                ))}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-primary/40 bg-primary/5 font-semibold">
                  <td className="sticky left-0 z-10 bg-primary/5 px-3 py-2.5">GENEL TOPLAM</td>
                  {codes.map((c) => (
                    <td key={c} className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{fmt(colTotal(c))}</td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-primary">{fmt(grandTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          <strong>Şirket ÷{report?.store_count ?? 7}</strong>: fatura fotoğrafları + kart Excel'i (onaylı dönemler), kategoride aylık toplam mağaza sayısına bölünür.
          <strong> Kasa</strong>: mağazanın kendi fişleri ve faturasız ödemeleri (işçi parası → Çalışma Ücreti; market → ½ temizlik + ½ yemek).
          <strong> POS %5</strong>: kilitli günlerin Visa toplamı × %5. <strong>Bordro</strong>: Maaşlar modülünden çalışma ücreti (baz maaş + ek hak ediş), prim (komisyon + primler) ve mesai.
          <strong> Elle</strong>: ay seçip hücreye tıkla (SSK, yol, elektrik, telefon, kargo, banka, muhasebe, sigorta, mağaza kiraları, ofis). 0 girince silinir.
        </p>
      </CardContent>
      {cashOpen && month !== 0 ? <CashItemsDialog year={year} month={month} brand={brand} onClose={() => setCashOpen(false)} /> : null}
    </Card>
  );
}
