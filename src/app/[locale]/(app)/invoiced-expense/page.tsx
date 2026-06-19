"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Upload as UploadIcon,
  Loader2,
  FileSpreadsheet,
  Trash2,
  Check,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KATEGORI_LABEL } from "@/lib/masraf/categorize";
import { MASRAF_KATEGORI_KEYS } from "@/lib/zod-schemas/invoiced-expense";

const MONTHS = [
  "", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];
const fmt = (n: number) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

export default function InvoicedExpensePage() {
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const { data: batches, isLoading } = trpc.invoicedExpense.list.useQuery({});

  const upload = trpc.invoicedExpense.upload.useMutation({
    onSuccess: (res) => {
      const yeni = res.created.filter((c) => !c.skipped);
      const atlanan = res.created.filter((c) => c.skipped);
      toast.success(
        `${yeni.length} dönem yüklendi${atlanan.length ? ` · ${atlanan.length} onaylı dönem atlandı` : ""}`
      );
      utils.invoicedExpense.list.invalidate();
      if (yeni[0]) setSelectedBatch(yeni[0].batch_id);
    },
    onError: (e) => toast.error(e.message),
  });

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const b64 = await fileToBase64(file);
      upload.mutate({ filename: file.name, file_base64: b64 });
    } catch {
      toast.error("Dosya okunamadı");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div>
      <PageHeader
        title="Faturalı Masraf (Şirket Kartı)"
        description="Kart ile ödenen masraf Excel'ini yükle. Sistem otomatik kategorize eder, döviz tutarlarını KKTC MB satış kuruyla TL'ye çevirir. Sonra 7 mağazaya eşit dağıtılır (Faz 3)."
      />

      {/* Yükleme alanı */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0])}
          />
          <div
            role="button"
            tabIndex={0}
            aria-disabled={upload.isPending}
            onClick={() => !upload.isPending && fileRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !upload.isPending) fileRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!upload.isPending) setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (!upload.isPending) onPick(e.dataTransfer.files?.[0]);
            }}
            className={`w-full rounded-2xl border-2 border-dashed transition-colors p-8 flex flex-col items-center gap-3 text-center cursor-pointer ${
              upload.isPending
                ? "opacity-60 cursor-not-allowed border-border"
                : dragActive
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-accent/30"
            }`}
          >
            {upload.isPending ? (
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
            ) : (
              <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <UploadIcon className="h-6 w-6" />
              </div>
            )}
            <div>
              <div className="font-semibold">
                {upload.isPending
                  ? "İşleniyor — kategorize + döviz çevrimi…"
                  : dragActive
                    ? "Bırak — dosyayı yükle"
                    : "Excel'i buraya sürükle ya da seçmek için tıkla"}
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">
                Sayfa adları OCAK..ARALIK olmalı · .xlsx · döviz satırları otomatik TL'ye çevrilir
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Batch listesi */}
      {isLoading ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">Yükleniyor…</CardContent></Card>
      ) : !batches || batches.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground animate-fade-in">
            <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <div className="font-medium text-foreground">Henüz yükleme yok</div>
            <div className="text-sm mt-1">Yukarıdan bir faturalı masraf dosyası yükle.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {batches.map((b) => (
            <div key={b.id}>
              <Card
                className={`transition-colors ${selectedBatch === b.id ? "border-primary/50" : ""}`}
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedBatch(selectedBatch === b.id ? null : b.id)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <ChevronRight
                      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${selectedBatch === b.id ? "rotate-90" : ""}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold flex items-center gap-2 flex-wrap">
                        {MONTHS[b.period_month]} {b.period_year}
                        {b.status === "confirmed" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium">
                            <Check className="h-2.5 w-2.5" /> Onaylı
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-[10px] font-medium">
                            Taslak
                          </span>
                        )}
                        {b.review_count > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 text-[10px] font-medium">
                            <AlertTriangle className="h-2.5 w-2.5" /> {b.review_count} gözden geçir
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {b.item_count} kalem · {b.source_filename ?? "—"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold tabular-nums">{fmt(b.total_try)} ₺</div>
                    </div>
                  </button>
                  <DeleteBatchButton batchId={b.id} />
                </CardContent>
              </Card>
              {selectedBatch === b.id ? (
                <BatchDetail batchId={b.id} confirmed={b.status === "confirmed"} />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeleteBatchButton({ batchId }: { batchId: string }) {
  const utils = trpc.useUtils();
  const del = trpc.invoicedExpense.delete.useMutation({
    onSuccess: () => {
      toast.success("Silindi");
      utils.invoicedExpense.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
      title="Dönemi sil"
      onClick={() => {
        if (confirm("Bu dönemi silmek istediğine emin misin?")) del.mutate({ batch_id: batchId });
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
  };
  const updateItem = trpc.invoicedExpense.updateItem.useMutation({
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });
  const confirmBatch = trpc.invoicedExpense.confirm.useMutation({
    onSuccess: () => {
      toast.success("Dönem onaylandı");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return (
      <div className="mx-2 mt-1 mb-2 rounded-lg border border-border/60 p-4 text-sm text-muted-foreground">
        Yükleniyor…
      </div>
    );
  }

  return (
    <div className="mx-2 mt-1 mb-3 rounded-xl border border-border/60 bg-muted/20 overflow-hidden animate-fade-in">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left font-medium py-2 px-3">Tarih</th>
              <th className="text-left font-medium py-2 px-3">Açıklama</th>
              <th className="text-right font-medium py-2 px-3">Tutar</th>
              <th className="text-left font-medium py-2 px-3">Kategori</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => {
              const foreign = it.currency !== "TRY";
              const date = new Date(it.expense_date);
              return (
                <tr key={it.id} className={`border-t border-border/40 ${it.needs_review ? "bg-rose-50/30" : ""}`}>
                  <td className="py-2 px-3 tabular-nums whitespace-nowrap">
                    {date.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", timeZone: "UTC" })}
                  </td>
                  <td className="py-2 px-3">
                    {it.raw_description}
                    {it.category === "KIRA" && it.belongs_month ? (
                      <span className="ml-1.5 text-[10px] text-indigo-600">→ {MONTHS[it.belongs_month]} kirası</span>
                    ) : null}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                    {fmt(Number(it.amount_try))} ₺
                    {foreign ? (
                      <div className="text-[10px] text-muted-foreground">
                        {fmt(Number(it.amount_original))} {it.currency} × {it.fx_rate ? Number(it.fx_rate).toFixed(4) : "?"}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2 px-3">
                    <Select
                      value={it.category}
                      disabled={confirmed}
                      onValueChange={(v) => updateItem.mutate({ id: it.id, category: v as (typeof MASRAF_KATEGORI_KEYS)[number] })}
                    >
                      <SelectTrigger className="h-8 w-48 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MASRAF_KATEGORI_KEYS.map((k) => (
                          <SelectItem key={k} value={k} className="text-xs">
                            {KATEGORI_LABEL[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!confirmed ? (
        <div className="flex items-center justify-between gap-3 p-3 border-t border-border/40 bg-background/50">
          <span className="text-xs text-muted-foreground">
            Kategorileri kontrol et, gerekirse düzelt. Onaylayınca dağıtıma (Faz 3) hazır olur.
          </span>
          <Button
            size="sm"
            disabled={confirmBatch.isPending}
            onClick={() => confirmBatch.mutate({ batch_id: batchId })}
          >
            {confirmBatch.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1.5" />
            )}
            Dönemi Onayla
          </Button>
        </div>
      ) : null}
    </div>
  );
}
