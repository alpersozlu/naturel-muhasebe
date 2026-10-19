"use client";

import { useRef, useState } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { Upload as UploadIcon, Loader2, FileSpreadsheet, Trash2, Check, AlertTriangle, ChevronRight, ChevronDown } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KATEGORI_LABEL } from "@/lib/masraf/categorize";
import { MASRAF_KATEGORI_KEYS } from "@/lib/zod-schemas/invoiced-expense";
import { MaviMatrixSection, type BrandKey } from "@/components/masraf/mavi-matrix-section";
import { InvoicePhotosSection } from "@/components/masraf/invoice-photos-section";

const MONTHS = ["", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BRANDS: { key: BrandKey; label: string }[] = [
  { key: "mavi", label: "Mavi" },
  { key: "derimod", label: "Derimod" },
];

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
  return btoa(bin);
}

export default function InvoicedExpensePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 0 = tüm yıl (yalnız matris)
  const [brand, setBrand] = useState<BrandKey>("mavi");
  const [legacyOpen, setLegacyOpen] = useState(false);
  const yearOptions = [now.getFullYear() + (now.getMonth() >= 10 ? 1 : 0), now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].filter((y, i, a) => a.indexOf(y) === i);
  const photoMonth = month === 0 ? now.getMonth() + 1 : month;

  return (
    <div>
      <PageHeader
        title="Masraflar"
        description="Ayın bütün masraf faturalarını fotoğrafla yükle; sistem okur, mağaza faturası mı şirket faturası mı ayırır, şirket faturalarını 7 mağazaya eşit dağıtır, kasa masraflarını ve bordroyu ekler ve 'Mavi Masraflar' tablosunu üretir."
      />

      {/* Dönem / marka seçici */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={brand} onValueChange={(v) => setBrand(v as BrandKey)}>
          <SelectTrigger className="h-9 w-[120px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{BRANDS.map((b) => <SelectItem key={b.key} value={b.key}>{b.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="h-9 w-[100px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="h-9 w-[140px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Tüm yıl (tablo)</SelectItem>
            {MONTHS.slice(1).map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Fotoğraflar seçili aya yüklenir{month === 0 ? ` (${MONTHS[photoMonth]})` : ""}.</span>
      </div>

      <InvoicePhotosSection year={year} month={photoMonth} />
      <MaviMatrixSection year={year} month={month} brand={brand} />

      {/* Eski yöntem: kart Excel'i */}
      <Card className="mt-6">
        <CardContent className="p-5">
          <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setLegacyOpen((v) => !v)}>
            {legacyOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">Kart Excel'i (eski yöntem — Ocak–Eylül 2026)</span>
            <span className="text-xs text-muted-foreground">şirket kartı masraf dosyası, ay ay onaylanır, ÷7 dağıtılır</span>
          </button>
          {legacyOpen ? <LegacyExcel /> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function LegacyExcel() {
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const { data: batches, isLoading } = trpc.invoicedExpense.list.useQuery({});
  const upload = trpc.invoicedExpense.upload.useMutation({
    onSuccess: (res) => {
      const yeni = res.created.filter((c) => !c.skipped);
      const atlanan = res.created.filter((c) => c.skipped);
      toast.success(`${yeni.length} dönem yüklendi${atlanan.length ? ` · ${atlanan.length} onaylı dönem atlandı` : ""}`);
      utils.invoicedExpense.list.invalidate();
      if (yeni[0]) setSelectedBatch(yeni[0].batch_id);
    },
    onError: (e) => toast.error(e.message),
  });
  const onPick = async (file: File | undefined) => {
    if (!file) return;
    try {
      upload.mutate({ filename: file.name, file_base64: await fileToBase64(file) });
    } catch {
      toast.error("Dosya okunamadı");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="mt-4 space-y-3">
      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
      <div
        role="button"
        tabIndex={0}
        aria-disabled={upload.isPending}
        onClick={() => !upload.isPending && fileRef.current?.click()}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !upload.isPending) fileRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); if (!upload.isPending) setDragActive(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
        onDrop={(e) => { e.preventDefault(); setDragActive(false); if (!upload.isPending) onPick(e.dataTransfer.files?.[0]); }}
        className={`flex w-full cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${upload.isPending ? "cursor-not-allowed border-border opacity-60" : dragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/30"}`}
      >
        {upload.isPending ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : <UploadIcon className="h-6 w-6 text-primary" />}
        <div className="text-sm font-medium">{upload.isPending ? "İşleniyor — kategorize + döviz çevrimi…" : "Excel'i buraya sürükle ya da seçmek için tıkla"}</div>
        <div className="text-xs text-muted-foreground">Sayfa adları OCAK..ARALIK olmalı · .xlsx · döviz satırları KKTC MB satış kuruyla TL'ye çevrilir</div>
      </div>

      {isLoading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Yükleniyor…</div>
      ) : !batches || batches.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Henüz yükleme yok.</div>
      ) : (
        <div className="space-y-2">
          {batches.map((b) => (
            <div key={b.id}>
              <Card className={`transition-colors ${selectedBatch === b.id ? "border-primary/50" : ""}`}>
                <CardContent className="flex items-center gap-3 p-3">
                  <button type="button" onClick={() => setSelectedBatch(selectedBatch === b.id ? null : b.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${selectedBatch === b.id ? "rotate-90" : ""}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-semibold">
                        {MONTHS[b.period_month]} {b.period_year}
                        {b.status === "confirmed" ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"><Check className="h-2.5 w-2.5" /> Onaylı</span>
                        ) : (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Taslak</span>
                        )}
                        {b.review_count > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700"><AlertTriangle className="h-2.5 w-2.5" /> {b.review_count} gözden geçir</span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{b.item_count} kalem · {b.source_filename ?? "—"}</div>
                    </div>
                    <div className="shrink-0 text-right"><div className="text-base font-bold tabular-nums">{fmt(b.total_try)} ₺</div></div>
                  </button>
                  <DeleteBatchButton batchId={b.id} />
                </CardContent>
              </Card>
              {selectedBatch === b.id ? <BatchDetail batchId={b.id} confirmed={b.status === "confirmed"} /> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeleteBatchButton({ batchId }: { batchId: string }) {
  const confirmDialog = useConfirm();
  const utils = trpc.useUtils();
  const del = trpc.invoicedExpense.delete.useMutation({
    onSuccess: () => { toast.success("Silindi"); utils.invoicedExpense.list.invalidate(); utils.invoicedExpense.report.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
      title="Dönemi sil"
      onClick={async () => {
        if (await confirmDialog({ title: "Dönem silinsin mi?", description: "Bu dönemin faturalı masraf kayıtları kaldırılır.", confirmLabel: "Sil", destructive: true })) del.mutate({ batch_id: batchId });
      }}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

function BatchDetail({ batchId, confirmed }: { batchId: string; confirmed: boolean }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.invoicedExpense.getBatch.useQuery({ batch_id: batchId });
  const invalidate = () => {
    utils.invoicedExpense.getBatch.invalidate({ batch_id: batchId });
    utils.invoicedExpense.list.invalidate();
    utils.invoicedExpense.report.invalidate();
  };
  const updateItem = trpc.invoicedExpense.updateItem.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const confirmBatch = trpc.invoicedExpense.confirm.useMutation({ onSuccess: () => { toast.success("Dönem onaylandı"); invalidate(); }, onError: (e) => toast.error(e.message) });

  if (isLoading || !data) return <div className="mx-2 mb-2 mt-1 rounded-lg border border-border/60 p-4 text-sm text-muted-foreground">Yükleniyor…</div>;

  return (
    <div className="mx-2 mb-3 mt-1 overflow-hidden rounded-xl border border-border/60 bg-muted/20 animate-fade-in">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Tarih</th>
              <th className="px-3 py-2 text-left font-medium">Açıklama</th>
              <th className="px-3 py-2 text-right font-medium">Tutar</th>
              <th className="px-3 py-2 text-left font-medium">Kategori</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => {
              const foreign = it.currency !== "TRY";
              const date = new Date(it.expense_date);
              return (
                <tr key={it.id} className={`border-t border-border/40 ${it.needs_review ? "bg-rose-50/30" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{date.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", timeZone: "UTC" })}</td>
                  <td className="px-3 py-2">
                    {it.raw_description}
                    {it.category === "KIRA" && it.belongs_month ? <span className="ml-1.5 text-[10px] text-indigo-600">→ {MONTHS[it.belongs_month]} kirası</span> : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {fmt(Number(it.amount_try))} ₺
                    {foreign ? <div className="text-[10px] text-muted-foreground">{fmt(Number(it.amount_original))} {it.currency} × {it.fx_rate ? Number(it.fx_rate).toFixed(4) : "?"}</div> : null}
                  </td>
                  <td className="px-3 py-2">
                    <Select value={it.category} disabled={confirmed} onValueChange={(v) => updateItem.mutate({ id: it.id, category: v as (typeof MASRAF_KATEGORI_KEYS)[number] })}>
                      <SelectTrigger className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{MASRAF_KATEGORI_KEYS.map((k) => <SelectItem key={k} value={k} className="text-xs">{KATEGORI_LABEL[k]}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!confirmed ? (
        <div className="flex items-center justify-between gap-3 border-t border-border/40 bg-background/50 p-3">
          <span className="text-xs text-muted-foreground">Kategorileri kontrol et, gerekirse düzelt. Onaylayınca dağıtıma girer.</span>
          <Button size="sm" disabled={confirmBatch.isPending} onClick={() => confirmBatch.mutate({ batch_id: batchId })}>
            {confirmBatch.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />} Dönemi Onayla
          </Button>
        </div>
      ) : null}
    </div>
  );
}
