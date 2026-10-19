"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  Camera,
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  Store,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { cn } from "@/lib/utils";
import { inferFileMime } from "@/lib/file-mime";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { KATEGORI_LABEL, SELECTABLE_KATEGORILER } from "@/lib/masraf/categorize";
import type { MASRAF_KATEGORI_KEYS } from "@/lib/zod-schemas/invoiced-expense";

/**
 * FATURA FOTOĞRAFLARI — sahibi ayın tüm masraf faturalarını fotoğraflar, buraya
 * atar. Sistem her faturayı okur; mağazanın "Yükle ve Analiz Et"te yüklediği
 * kayıtla eşleşirse MAĞAZA FATURASI (kasada zaten sayıldı), eşleşmezse ŞİRKET
 * FATURASI (kategorisinde ÷7 dağıtılır). Mükerrer çekim ve okunamayanlar ayrı.
 */

const MONTHS = ["", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "—");
const TARGET_MAX = 3 * 1024 * 1024;
type Kategori = (typeof MASRAF_KATEGORI_KEYS)[number];

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      const i = s.indexOf(",");
      res(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => rej(new Error("dosya okunamadı"));
    r.readAsDataURL(blob);
  });
}

/** Telefon fotoğrafı 3–8 MB gelir; 2200 px JPEG'e küçült (fatura rakamları için yeterli). */
async function shrink(file: File): Promise<{ blob: Blob; mime: string }> {
  const mime = inferFileMime(file);
  const canvasOk = mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
  if (!canvasOk || file.size <= TARGET_MAX) return { blob: file, mime };
  const bmp = await createImageBitmap(file);
  const max = 2200;
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * r);
  canvas.height = Math.round(bmp.height * r);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { blob: file, mime };
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.88));
  return blob ? { blob, mime: "image/jpeg" } : { blob: file, mime };
}

const CLASS_META: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  company: { label: "Şirket faturası · ÷7", cls: "bg-indigo-50 text-indigo-800 ring-indigo-200", icon: <Building2 className="h-3.5 w-3.5" /> },
  store: { label: "Mağaza faturası", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", icon: <Store className="h-3.5 w-3.5" /> },
  duplicate: { label: "Mükerrer çekim", cls: "bg-amber-50 text-amber-900 ring-amber-200", icon: <Copy className="h-3.5 w-3.5" /> },
  excluded: { label: "Çıkarıldı", cls: "bg-muted text-muted-foreground ring-border", icon: <XCircle className="h-3.5 w-3.5" /> },
  pending: { label: "Bekliyor", cls: "bg-muted text-muted-foreground ring-border", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
};

export function InvoicePhotosSection({ year, month }: { year: number; month: number }) {
  const utils = trpc.useUtils();
  const confirmDialog = useConfirm();
  const q = trpc.invoicedExpense.photosList.useQuery({ year, month }, { refetchOnWindowFocus: false });
  const upload = trpc.invoicedExpense.photosUpload.useMutation();
  const read = trpc.invoicedExpense.photosRead.useMutation();
  const invalidate = () => {
    void utils.invoicedExpense.photosList.invalidate({ year, month });
    void utils.invoicedExpense.report.invalidate();
  };
  const update = trpc.invoicedExpense.photosUpdate.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const del = trpc.invoicedExpense.photosDelete.useMutation({ onSuccess: () => { toast.success("Fotoğraf kaldırıldı"); invalidate(); }, onError: (e) => toast.error(e.message) });
  const rematch = trpc.invoicedExpense.photosRematch.useMutation({
    onSuccess: (r) => { toast.success(`${r.checked} fatura yeniden eşleştirildi · ${r.changed} değişti`); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const retry = trpc.invoicedExpense.photosRetry.useMutation({ onSuccess: invalidate, onError: (e) => toast.error(e.message) });
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const [filter, setFilter] = useState<"all" | "company" | "store" | "review">("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);

  const ingest = async (list: FileList | File[]) => {
    const files = Array.from(list).slice(0, 40);
    if (files.length === 0) return;
    setProgress({ done: 0, total: files.length });
    try {
      const payload: { name: string; mime_type: "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif" | "application/pdf"; base64: string }[] = [];
      for (const f of files) {
        const { blob, mime } = await shrink(f);
        if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"].includes(mime)) {
          toast.error(`${f.name}: yalnız fotoğraf ya da PDF yüklenebilir`);
          continue;
        }
        payload.push({ name: f.name, mime_type: mime as (typeof payload)[number]["mime_type"], base64: await blobToBase64(blob) });
      }
      if (payload.length === 0) return;
      const r = await upload.mutateAsync({ year, month, files: payload });
      if (r.skipped.length) toast.info(r.skipped.map((s) => `${s.name}: ${s.reason}`).join(" · "));
      if (r.linked.length) toast.success(`${r.linked.length} fotoğraf mağazanın yüklediği dosyayla birebir aynı — mağaza faturası sayıldı`);
      let done = 0;
      let company = 0;
      let store = 0;
      let failed = 0;
      for (const id of r.created) {
        const o = await read.mutateAsync({ id });
        done += 1;
        setProgress({ done, total: r.created.length });
        if (o.ocr_status !== "done") failed += 1;
        else if (o.classification === "store") store += 1;
        else if (o.classification === "company") company += 1;
        if (done % 5 === 0) invalidate();
      }
      invalidate();
      if (r.created.length) toast.success(`${done} fatura okundu · ${company} şirket · ${store} mağaza${failed ? ` · ${failed} okunamadı` : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Yükleme başarısız");
      invalidate();
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  };

  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const s = q.data?.summary;
  const storeCount = q.data?.store_count ?? 7;
  const shown = useMemo(() => {
    if (filter === "company") return items.filter((i) => i.classification === "company");
    if (filter === "store") return items.filter((i) => i.classification === "store");
    if (filter === "review") return items.filter((i) => i.ocr_status !== "done" || i.needs_review || i.classification === "duplicate");
    return items;
  }, [items, filter]);
  const busy = !!progress;
  const editItem = editing ? items.find((i) => i.id === editing) ?? null : null;

  return (
    <Card
      className={cn(drag && "ring-2 ring-indigo-300")}
      onDragEnter={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { if (!e.dataTransfer.types.includes("Files")) return; e.preventDefault(); setDrag(false); if (!busy) void ingest(e.dataTransfer.files); }}
    >
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
            <Camera className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold leading-tight">Fatura fotoğrafları — {MONTHS[month]} {year}</h2>
              {s ? (
                <span className="text-xs text-muted-foreground">
                  {s.total} fatura · {s.company} şirket ({fmt(s.company_total)} ₺ → mağaza başına {fmt(s.company_total / storeCount)} ₺) · {s.store} mağaza ({fmt(s.store_total)} ₺)
                  {s.duplicate ? ` · ${s.duplicate} mükerrer` : ""}{s.failed ? ` · ${s.failed} okunamadı` : ""}{s.review ? ` · ${s.review} gözden geçir` : ""}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Ayın bütün masraf faturalarını (şirket + mağaza) tek tek fotoğraflayıp buraya bırak. Mağazanın &quot;Yükle ve Analiz Et&quot;te yüklediği
              fişle eşleşen fatura <strong>mağaza faturası</strong> sayılır (kasada zaten var, ikinci kez sayılmaz); eşleşmeyen <strong>şirket faturası</strong> olur ve
              kategorisinde {storeCount} mağazaya eşit dağıtılır. Market → ½ temizlik + ½ yemek. Mağaza fişi sonradan yüklenirse sistem kendisi yeniden eşleştirir.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={input} type="file" accept="image/*,.heic,.heif,.pdf" multiple className="hidden" onChange={(e) => e.target.files && void ingest(e.target.files)} />
            <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Camera className="mr-1.5 h-4 w-4" />}
              {busy ? `Okunuyor ${progress!.done}/${progress!.total}` : "Fotoğraf yükle"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy || rematch.isPending || items.length === 0} onClick={() => rematch.mutate({ year, month })} title="Mağaza sonradan fiş yüklediyse eşleşmeleri tazeler">
              {rematch.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
              Yeniden eşleştir
            </Button>
          </div>
        </div>

        {items.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs">
            {(
              [
                ["all", `Tümü (${items.length})`],
                ["company", `Şirket (${s?.company ?? 0})`],
                ["store", `Mağaza (${s?.store ?? 0})`],
                ["review", `Gözden geçir (${(s?.review ?? 0) + (s?.failed ?? 0) + (s?.duplicate ?? 0)})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={cn("rounded-full border px-2.5 py-1 transition-colors", filter === k ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground hover:bg-accent/40")}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {q.isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Yükleniyor…</div>
        ) : items.length === 0 ? (
          <div className="mt-4 rounded-xl border-2 border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Bu ay için henüz fotoğraf yok — faturaları buraya sürükle ya da &quot;Fotoğraf yükle&quot;ye bas.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-border/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Tarih</th>
                  <th className="px-3 py-2 text-left font-medium">Satıcı · açıklama</th>
                  <th className="px-3 py-2 text-left font-medium">Belge no</th>
                  <th className="px-3 py-2 text-right font-medium">Tutar</th>
                  <th className="px-3 py-2 text-left font-medium">Kategori</th>
                  <th className="px-3 py-2 text-left font-medium">Durum</th>
                  <th className="px-3 py-2 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {shown.map((it) => {
                  const meta = CLASS_META[it.ocr_status === "done" ? it.classification : it.ocr_status === "failed" ? "excluded" : "pending"] ?? CLASS_META.pending;
                  const failed = it.ocr_status === "failed";
                  const warn = it.needs_review && it.ocr_status === "done";
                  return (
                    <tr key={it.id} className={cn("border-t border-border/40 align-top", failed && "bg-rose-50/40", warn && !failed && "bg-amber-50/30", it.classification === "excluded" && "opacity-60")}>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                        {dmy(it.expense_date)}
                        {it.belongs_month ? <div className="text-[10px] text-indigo-600">→ {MONTHS[it.belongs_month]} kirası</div> : null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{it.vendor ?? <span className="text-muted-foreground">satıcı okunamadı</span>}</div>
                        {it.description ? <div className="text-xs text-muted-foreground line-clamp-2">{it.description}</div> : null}
                        {failed ? <div className="mt-0.5 text-xs text-rose-700">{it.ocr_error}</div> : null}
                        {it.ocr_error && !failed ? <div className="mt-0.5 text-xs text-amber-700">{it.ocr_error}</div> : null}
                        {it.source_name ? <div className="text-[10px] text-muted-foreground/70">{it.source_name}</div> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-xs text-muted-foreground">{it.document_no ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {it.amount_try != null ? <div className="font-medium">{fmt(it.amount_try)} ₺</div> : <span className="text-muted-foreground">—</span>}
                        {it.currency !== "TRY" && it.amount_original != null ? <div className="text-[10px] text-muted-foreground">{fmt(it.amount_original)} {it.currency}</div> : null}
                        {it.per_store != null ? <div className="text-[10px] text-indigo-600">mağaza başı {fmt(it.per_store)}</div> : null}
                      </td>
                      <td className="px-3 py-2">
                        {it.ocr_status === "done" && it.classification !== "store" ? (
                          <Select value={it.category ?? "DIGER"} onValueChange={(v) => update.mutate({ id: it.id, category: v as Kategori })}>
                            <SelectTrigger className={cn("h-8 w-52 text-xs", warn && "border-amber-300")}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SELECTABLE_KATEGORILER.map((k) => (
                                <SelectItem key={k} value={k} className="text-xs">{KATEGORI_LABEL[k]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : it.classification === "store" ? (
                          <span className="text-xs text-muted-foreground">{it.category ? KATEGORI_LABEL[it.category as Kategori] : "—"}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {warn && it.auto_category === it.category && it.category === "DIGER" ? <div className="mt-0.5 text-[10px] text-amber-700">kategori bulunamadı — kontrol et</div> : null}
                      </td>
                      <td className="px-3 py-2">
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", meta.cls)}>
                          {meta.icon} {failed ? "Okunamadı" : meta.label}
                        </span>
                        {it.matched ? (
                          <div className="mt-1 text-[11px] text-emerald-800">
                            {it.matched.store_name} · {dmy(it.matched.date)} · {fmt(it.matched.amount_try)} ₺
                            {it.match_method === "file_hash" ? " · aynı dosya" : it.match_method === "document_no" ? " · belge no" : it.match_method === "manual" ? " · elle bağlandı" : ""}
                          </div>
                        ) : null}
                        {it.duplicate_of ? <div className="mt-1 text-[11px] text-amber-800">{it.duplicate_of.vendor ?? "aynı fatura"} · {it.duplicate_of.amount_try != null ? `${fmt(it.duplicate_of.amount_try)} ₺` : ""} zaten var</div> : null}
                        {it.decided ? <div className="mt-0.5 text-[10px] text-muted-foreground">yönetici kararı{it.decision_note ? ` · ${it.decision_note}` : ""}</div> : null}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">
                        <PhotoLink id={it.id} />
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Düzelt (satıcı / tarih / tutar / ay)" onClick={() => setEditing(it.id)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {failed ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Yeniden oku" disabled={retry.isPending} onClick={() => retry.mutate({ id: it.id })}>
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        {it.classification !== "company" ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-indigo-700" title="Şirket faturası say (÷7)" onClick={() => update.mutate({ id: it.id, classification: "company" })}>
                            <Building2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        {it.classification !== "store" ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-700" title="Mağazanın masraf kaydına bağla" onClick={() => setLinking(it.id)}>
                            <Link2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        {it.classification !== "excluded" ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Tablodan çıkar (masraf değil)" onClick={() => update.mutate({ id: it.id, classification: "excluded" })}>
                            <XCircle className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        {it.decided ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Kararı geri al — otomatik eşleştir" onClick={() => update.mutate({ id: it.id, classification: "pending" })}>
                            <Undo2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title="Fotoğrafı kaldır"
                          onClick={async () => {
                            if (await confirmDialog({ title: "Fotoğraf kaldırılsın mı?", description: "Bu fatura masraf tablosundan düşer. Aynı fotoğraf tekrar yüklenirse geri gelir.", confirmLabel: "Kaldır", destructive: true }))
                              del.mutate({ id: it.id });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {editItem ? (
        <EditDialog
          item={editItem}
          onClose={() => setEditing(null)}
          onSave={(data) => update.mutate({ id: editItem.id, ...data }, { onSuccess: () => setEditing(null) })}
          saving={update.isPending}
        />
      ) : null}
      {linking ? <LinkDialog id={linking} onClose={() => setLinking(null)} onDone={() => { setLinking(null); invalidate(); }} /> : null}
    </Card>
  );
}

function PhotoLink({ id }: { id: string }) {
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      title="Fotoğrafı aç"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await utils.invoicedExpense.photoUrl.fetch({ id });
          window.open(r.url, "_blank", "noopener");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Fotoğraf açılamadı");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
    </Button>
  );
}

type Item = inferRouterOutputs<AppRouter>["invoicedExpense"]["photosList"]["items"][number];

function EditDialog({ item, onClose, onSave, saving }: { item: Item; onClose: () => void; onSave: (d: { vendor?: string | null; expense_date?: string; amount_try?: number; period_month?: number; belongs_month?: number | null; note?: string | null }) => void; saving: boolean }) {
  const [vendor, setVendor] = useState(item.vendor ?? "");
  const [date, setDate] = useState(item.expense_date ?? "");
  const [amount, setAmount] = useState<number | undefined>(item.amount_try ?? undefined);
  const [period, setPeriod] = useState(String(new Date().getUTCMonth() + 1));
  const [belongs, setBelongs] = useState(item.belongs_month ? String(item.belongs_month) : "0");
  const [note, setNote] = useState(item.decision_note ?? "");
  const [periodTouched, setPeriodTouched] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Faturayı düzelt</DialogTitle>
          <DialogDescription>OCR yanlış okuduysa burada düzelt. Tutar TL olarak girilir.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Satıcı</Label>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Belge tarihi</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Tutar (₺)</Label>
              <MoneyInput value={amount} onChange={setAmount} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Dağıtım ayı</Label>
              <Select value={period} onValueChange={(v) => { setPeriod(v); setPeriodTouched(true); }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{MONTHS.slice(1).map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Kira ait olduğu ay</Label>
              <Select value={belongs} onValueChange={setBelongs}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">—</SelectItem>
                  {MONTHS.slice(1).map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Not</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="isteğe bağlı" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button
            disabled={saving}
            onClick={() =>
              onSave({
                vendor: vendor.trim() || null,
                ...(date ? { expense_date: date } : {}),
                ...(amount != null ? { amount_try: amount } : {}),
                ...(periodTouched ? { period_month: Number(period) } : {}),
                belongs_month: belongs === "0" ? null : Number(belongs),
                note: note.trim() || null,
              })
            }
          >
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />} Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const q = trpc.invoicedExpense.photosCandidates.useQuery({ id });
  const link = trpc.invoicedExpense.photosLink.useMutation({ onSuccess: () => { toast.success("Mağaza faturası olarak bağlandı"); onDone(); }, onError: (e) => toast.error(e.message) });
  const [search, setSearch] = useState("");
  const rows = (q.data ?? []).filter((r) => !search || `${r.store_name} ${r.vendor ?? ""} ${r.description ?? ""}`.toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr")));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mağazanın masraf kaydına bağla</DialogTitle>
          <DialogDescription>Bu fotoğraf mağazanın yüklediği bir fişle aynıysa seç — mağaza faturası sayılır, ÷7 dağıtımına girmez.</DialogDescription>
        </DialogHeader>
        <Input placeholder="mağaza / satıcı / açıklama ara" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-80 overflow-y-auto rounded-lg border border-border/60">
          {q.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Yükleniyor…</div>
          ) : rows.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Aday kayıt yok.</div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={cn("border-b border-border/40", r.taken && "opacity-50")}>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{dmy(r.date)}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.store_name}</div>
                      <div className="text-xs text-muted-foreground">{r.vendor ?? "—"}{r.document_no ? ` · No ${r.document_no}` : ""}{r.description ? ` · ${r.description}` : ""}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmt(r.amount_try)} ₺</td>
                    <td className="px-2 py-1 text-right">
                      <Button size="sm" variant="outline" disabled={r.taken || link.isPending} onClick={() => link.mutate({ id, expense_id: r.id })}>
                        {r.taken ? "bağlı" : "Bağla"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Kapat</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

