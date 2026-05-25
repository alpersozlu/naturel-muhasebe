"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Loader2, Wallet } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACCEPTED_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/constants";
import { EXPENSE_CATEGORIES } from "@/lib/zod-schemas/budget";

const ACCEPT_ATTR = ACCEPTED_MIME_TYPES.join(",");
const TARGET_MAX_BYTES = 3 * 1024 * 1024;

const CATEGORY_LABEL: Record<string, string> = {
  rent: "Kira",
  electricity: "Elektrik",
  water: "Su",
  internet: "İnternet",
  stationery: "Kırtasiye",
  cleaning: "Temizlik",
  maintenance: "Bakım",
  salary: "Maaş",
  bonus: "Prim/Avans",
  supplies: "Sarf Malzeme",
  marketing: "Pazarlama",
  other: "Diğer",
};

type CategoryKey = (typeof EXPENSE_CATEGORIES)[number];

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function compressImageIfNeeded(file: File): Promise<{
  blob: Blob;
  mimeType: string;
  filename: string;
}> {
  const t = file.type;
  const isCompressible =
    t === "image/jpeg" || t === "image/png" || t === "image/webp";
  if (!isCompressible) return { blob: file, mimeType: t, filename: file.name };
  if (file.size <= TARGET_MAX_BYTES)
    return { blob: file, mimeType: t, filename: file.name };

  const bitmap = await createImageBitmap(file);
  const maxDim = 2000;
  let w = bitmap.width;
  let h = bitmap.height;
  if (Math.max(w, h) > maxDim) {
    const ratio = maxDim / Math.max(w, h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas context oluşturulamadı");
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let quality = 0.85;
  let blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
  if (blob && blob.size > TARGET_MAX_BYTES) {
    quality = 0.7;
    blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
    );
  }
  if (!blob) throw new Error("Görsel sıkıştırma başarısız");
  const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return { blob, mimeType: "image/jpeg", filename: newName };
}

function humanizeUploadError(msg: string): string {
  if (
    msg.includes("Unexpected token") ||
    msg.includes("not valid JSON") ||
    msg.includes("Request Entity Too Large") ||
    msg.includes("413")
  ) {
    return "Dosya çok büyük olabilir. Lütfen daha küçük çözünürlükte bir görsel yükleyin.";
  }
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    return "Ağ hatası — bağlantını kontrol et ve tekrar dene.";
  }
  return msg;
}

export function MasrafFaturaCard({
  storeId,
  date,
}: {
  storeId: string;
  date: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [category, setCategory] = useState<CategoryKey | "">("");
  const [description, setDescription] = useState("");

  const utils = trpc.useUtils();
  const create = trpc.upload.create.useMutation();

  // Kategori VEYA açıklama'dan en az biri zorunlu (zod server-side de kontrol eder)
  const metaReady = !!category || description.trim().length > 0;
  const disabled = !storeId || !date || uploading || !metaReady;
  const metaMissingReason = !metaReady
    ? "Önce kategori seç veya açıklama gir"
    : null;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!storeId || !date) {
      toast.error("Önce mağaza ve tarih seç");
      return;
    }
    if (!metaReady) {
      toast.error("Kategori veya açıklama girilmeli (en az biri)");
      return;
    }

    setUploading(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      try {
        if (file.size > MAX_UPLOAD_BYTES) {
          toast.error(
            `${file.name}: ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB'dan büyük`
          );
          continue;
        }
        const { blob, mimeType, filename } = await compressImageIfNeeded(file);
        if (blob.size > TARGET_MAX_BYTES) {
          toast.error(
            `${file.name}: sıkıştırma sonrası bile çok büyük (${(blob.size / 1024 / 1024).toFixed(1)} MB).`
          );
          continue;
        }
        const base64 = await blobToBase64(blob);
        await create.mutateAsync({
          store_id: storeId,
          date,
          type: "expense",
          filename,
          mime_type: mimeType as (typeof ACCEPTED_MIME_TYPES)[number],
          file_base64: base64,
          user_meta: {
            expense_category: category || undefined,
            expense_description: description || undefined,
          },
        });
        ok++;
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        toast.error(`${file.name}: ${humanizeUploadError(raw)}`);
      }
    }

    if (ok > 0) {
      toast.success(
        ok === 1 ? "Yüklendi · arka planda analiz ediliyor" : `${ok} dosya yüklendi · analiz ediliyor`
      );
      utils.upload.listForStoreDate.invalidate({ store_id: storeId, date });
      // Yükleme sonrası form alanlarını sıfırla
      setCategory("");
      setDescription("");
    }

    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const openPicker = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setDragActive(true);
    }
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      setDragActive(false);
      dragCounter.current = 0;
    }
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) e.dataTransfer.dropEffect = "copy";
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragActive(false);
    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  };

  return (
    <Card
      className={`transition-all ${disabled ? "opacity-50" : ""} ${
        dragActive ? "border-primary border-2 bg-primary/5 shadow-md" : ""
      }`}
    >
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div
            className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
              dragActive ? "bg-primary/15 text-primary" : "bg-rose-50 text-rose-600"
            }`}
          >
            <Wallet className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium">Masraf / Fatura</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Kategori <span className="text-rose-500">*</span> veya açıklama{" "}
              <span className="text-rose-500">*</span> zorunlu, sonra dosyayı yükle
            </div>
          </div>
        </div>

        {/* Kategori */}
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Kategori
          </Label>
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as CategoryKey)}
            disabled={disabled}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Seçim yok (OCR otomatik tahmin eder)" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Açıklama */}
        <div className="space-y-1.5">
          <Label
            htmlFor="masraf-aciklama"
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            Açıklama
          </Label>
          <textarea
            id="masraf-aciklama"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={disabled}
            rows={2}
            placeholder="örn 'Mart kira', 'temizlik malzemesi'"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
          />
        </div>

        {/* Drop zone */}
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          onClick={openPicker}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !disabled) {
              e.preventDefault();
              openPicker();
            }
          }}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`rounded-xl border-2 border-dashed p-4 text-center transition-all outline-none ${
            disabled
              ? "border-border bg-muted/20 cursor-not-allowed"
              : dragActive
                ? "border-primary bg-primary/5 cursor-copy"
                : "border-border hover:border-primary/50 cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/40"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-1">
              <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
            </div>
          ) : metaMissingReason ? (
            <div className="flex items-center justify-center gap-2 text-sm text-rose-600/80">
              <Upload className="h-4 w-4" />
              {metaMissingReason}
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Upload className="h-4 w-4" />
              {dragActive
                ? "Bırak — yüklenecek"
                : "Sürükle bırak veya seçmek için tıkla"}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
