"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Table2, Clock } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

const fmt = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SOURCE_META: Record<string, { label: string; cls: string }> = {
  invoiced: { label: "Faturalı", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  cash: { label: "Kasa", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  pos: { label: "POS", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  defolu: { label: "Defolu", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

function triggerXlsxDownload(base64: string, filename: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const BRANDS = [
  { key: "mavi", label: "Mavi" },
  { key: "derimod", label: "Derimod" },
] as const;
type BrandKey = (typeof BRANDS)[number]["key"];

export function MaviMatrixSection() {
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);
  const [month, setMonth] = useState(0); // 0 = tüm yıl
  const [brand, setBrand] = useState<BrandKey>("mavi");
  const [xlsxLoading, setXlsxLoading] = useState(false);

  const { data: report, isLoading } = trpc.invoicedExpense.report.useQuery({ year, brand });
  const exportXlsx = trpc.invoicedExpense.exportMatrix.useMutation();

  const yearOptions = [nowYear, nowYear - 1, nowYear - 2];

  const handleExcel = async () => {
    setXlsxLoading(true);
    try {
      const { base64, filename } = await exportXlsx.mutateAsync({ year, brand });
      triggerXlsxDownload(base64, filename);
      toast.success("Excel indirildi (tüm yıl — Dosya 3 formatı)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Excel oluşturulamadı");
    } finally {
      setXlsxLoading(false);
    }
  };

  // Bir satır + mağaza için gösterilecek değer (tüm yıl = storeTotals, ay = hücre)
  const cellValue = (
    r: NonNullable<typeof report>["rows"][number],
    code: string
  ): number =>
    month === 0
      ? r.storeTotals[code] ?? 0
      : r.cells[month]?.[code]?.total ?? 0;

  // Bir satırın seçili dönemdeki toplamı
  const rowValue = (r: NonNullable<typeof report>["rows"][number]): number =>
    month === 0
      ? r.rowTotal
      : (report?.storeCodes ?? []).reduce((s, c) => s + cellValue(r, c), 0);

  // Seçili dönemde bu satıra katkı yapan kaynaklar (rozet — aya duyarlı)
  const rowSources = (
    r: NonNullable<typeof report>["rows"][number]
  ): string[] => {
    if (month === 0) return r.sources;
    const byStore = r.cells[month];
    if (!byStore) return [];
    const acc = { invoiced: false, cash: false, pos: false, defolu: false };
    for (const cell of Object.values(byStore)) {
      if (cell.invoiced) acc.invoiced = true;
      if (cell.cash) acc.cash = true;
      if (cell.pos) acc.pos = true;
      if (cell.defolu) acc.defolu = true;
    }
    return (["invoiced", "cash", "pos", "defolu"] as const).filter((s) => acc[s]);
  };

  // Alt TOPLAM satırı
  const colTotal = (code: string): number => {
    if (!report) return 0;
    return month === 0
      ? report.storeTotals[code] ?? 0
      : report.columnTotals[month]?.[code] ?? 0;
  };
  const grandTotal = useMemo(() => {
    if (!report) return 0;
    return month === 0 ? report.autoTotal : report.monthTotals[month] ?? 0;
  }, [report, month]);

  const codes = report?.storeCodes ?? [];

  return (
    <Card className="mt-8">
      <CardContent className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Table2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold leading-tight">{report?.title ?? "Masraf Matrisi"}</h2>
              <p className="text-xs text-muted-foreground">
                Kategori × mağaza · faturalı + kasa + POS · manuel kategoriler elle doldurulur
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={brand} onValueChange={(v) => setBrand(v as BrandKey)}>
              <SelectTrigger className="h-9 w-[120px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BRANDS.map((b) => (
                  <SelectItem key={b.key} value={b.key}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-9 w-[110px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="h-9 w-[140px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Tüm Yıl</SelectItem>
                {MONTHS.map((m, i) => (
                  <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={xlsxLoading} onClick={handleExcel}>
              {xlsxLoading ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1.5" />
              )}
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
                  <th className="text-left font-medium py-2 px-3 sticky left-0 bg-muted/40 z-10">
                    Kategori
                  </th>
                  {codes.map((c) => (
                    <th key={c} className="text-right font-medium py-2 px-3 whitespace-nowrap">
                      {c} {report.storeNames[c]}
                    </th>
                  ))}
                  <th className="text-right font-medium py-2 px-3">
                    {month === 0 ? "Yıl Toplam" : "Ay Toplam"}
                  </th>
                  <th className="text-left font-medium py-2 px-3">Kaynak</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => {
                  const rTotal = rowValue(r);
                  const empty = !r.auto;
                  const srcs = rowSources(r);
                  return (
                    <tr
                      key={r.key}
                      className={`border-t border-border/40 ${empty ? "bg-amber-50/40" : ""}`}
                    >
                      <td
                        className={`py-2 px-3 sticky left-0 z-10 ${empty ? "bg-amber-50/60" : "bg-background"}`}
                        title={r.note ?? undefined}
                      >
                        <span className={empty ? "text-muted-foreground" : "font-medium"}>
                          {r.label}
                        </span>
                      </td>
                      {codes.map((c) => {
                        const v = cellValue(r, c);
                        return (
                          <td
                            key={c}
                            className={`py-2 px-3 text-right tabular-nums whitespace-nowrap ${v === 0 ? "text-muted-foreground/40" : ""}`}
                          >
                            {empty ? "—" : v === 0 ? "·" : fmt(v)}
                          </td>
                        );
                      })}
                      <td className="py-2 px-3 text-right tabular-nums font-semibold whitespace-nowrap">
                        {empty ? "—" : rTotal === 0 ? "·" : fmt(rTotal)}
                      </td>
                      <td className="py-2 px-3">
                        {empty ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-[10px] font-medium whitespace-nowrap">
                            <Clock className="h-2.5 w-2.5" /> manuel bekliyor
                          </span>
                        ) : srcs.length === 0 ? (
                          <span className="text-[10px] text-muted-foreground">veri yok</span>
                        ) : (
                          <span className="inline-flex gap-1 flex-wrap">
                            {srcs.map((s) => (
                              <span
                                key={s}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${SOURCE_META[s]?.cls ?? ""}`}
                              >
                                {SOURCE_META[s]?.label ?? s}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-primary/40 bg-primary/5 font-semibold">
                  <td className="py-2.5 px-3 sticky left-0 bg-primary/5 z-10">TOPLAM (otomatik)</td>
                  {codes.map((c) => (
                    <td key={c} className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                      {fmt(colTotal(c))}
                    </td>
                  ))}
                  <td className="py-2.5 px-3 text-right tabular-nums text-primary">{fmt(grandTotal)}</td>
                  <td className="py-2.5 px-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
          <strong>Otomatik</strong> satırlar onaylı faturalı dönemler (÷{report?.store_count ?? 7}),
          mağaza kasası, POS %5 ve <strong className="text-rose-700">Defolu</strong> (İndirim Kontrol
          programından otomatik push) ile dolar. <strong className="text-amber-700">Manuel bekliyor</strong> satırlar
          (Çalışma Ücreti, Elektrik, Telefon/İnternet, Kargo, Banka, Muhasebe, Sigorta, diğer mağaza
          kiraları) Excel'de boş gelir — muhasebede elle doldurulur. Kasa/POS/Defolu gerçek veri
          girildikçe tablo otomatik dolar.
        </p>
      </CardContent>
    </Card>
  );
}
