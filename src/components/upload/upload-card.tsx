"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Loader2, type LucideIcon } from "lucide-react";
import type { UploadType } from "@prisma/client";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ACCEPTED_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/constants";

const ACCEPT_ATTR = ACCEPTED_MIME_TYPES.join(",");

// Vercel serverless body limit ~4.5 MB. Base64 ~33% şişirir, dolayısıyla
// raw payload'u ~3 MB altında tutmamız gerek.
const TARGET_MAX_BYTES = 3 * 1024 * 1024;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result: "data:image/png;base64,XXXX..."
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Görseli canvas üzerinden yeniden boyutlandırıp JPEG'e çevirir.
 * HEIC/PDF bypass edilir (browser canvas onları decode edemez,
 * HEIC server-side heic-convert ile dönüştürülecek).
 */
async function compressImageIfNeeded(file: File): Promise<{
  blob: Blob;
  mimeType: string;
  filename: string;
}> {
  const t = file.type;
  const isCompressible =
    t === "image/jpeg" || t === "image/png" || t === "image/webp";

  if (!isCompressible) {
    return { blob: file, mimeType: t, filename: file.name };
  }

  // Küçük dosyaları olduğu gibi geç — gereksiz işlem
  if (file.size <= TARGET_MAX_BYTES) {
    return { blob: file, mimeType: t, filename: file.name };
  }

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

  // İlk denemede 0.85 kalite, hâlâ büyükse 0.7'ye düşür
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

/**
 * Yükleme hatası gelirse kullanıcı dostu mesaja çevir.
 */
function humanizeUploadError(msg: string): string {
  if (
    msg.includes("Unexpected token") ||
    msg.includes("not valid JSON") ||
    msg.includes("Request Entity Too Large") ||
    msg.includes("413")
  ) {
    return "Dosya çok büyük olabilir. Lütfen daha küçük çözünürlükte bir görsel yüklemeyi dene.";
  }
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    return "Ağ hatası — bağlantını kontrol et ve tekrar dene.";
  }
  return msg;
}

export function UploadCard({
  type,
  label,
  icon: Icon,
  iconBg,
  iconColor,
  storeId,
  date,
  multiple = false,
}: {
  type: UploadType;
  label: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  storeId: string;
  date: string;
  multiple?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const utils = trpc.useUtils();

  const create = trpc.upload.create.useMutation();

  const disabled = !storeId || !date || uploading;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!storeId || !date) {
      toast.error("Önce mağaza ve tarih seç");
      return;
    }

    setUploading(true);
    let ok = 0;
    let fail = 0;

    for (const file of Array.from(files)) {
      try {
        if (file.size > MAX_UPLOAD_BYTES) {
          toast.error(
            `${file.name}: ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB'dan büyük`
          );
          fail++;
          continue;
        }
        const { blob, mimeType, filename } = await compressImageIfNeeded(file);
        if (blob.size > TARGET_MAX_BYTES) {
          toast.error(
            `${file.name}: sıkıştırma sonrası bile çok büyük (${(blob.size / 1024 / 1024).toFixed(1)} MB). Daha küçük çözünürlüklü bir görsel yükleyin.`
          );
          fail++;
          continue;
        }
        const base64 = await blobToBase64(blob);
        await create.mutateAsync({
          store_id: storeId,
          date,
          type,
          filename,
          mime_type: mimeType as (typeof ACCEPTED_MIME_TYPES)[number],
          file_base64: base64,
        });
        ok++;
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        toast.error(`${file.name}: ${humanizeUploadError(raw)}`);
        fail++;
      }
    }

    if (ok > 0) {
      toast.success(
        ok === 1 ? "Yüklendi · arka planda analiz ediliyor" : `${ok} dosya yüklendi · analiz ediliyor`
      );
      utils.upload.listForStoreDate.invalidate({ store_id: storeId, date });
    }
    if (fail > 0 && ok === 0) {
      // already toasted per-file
    }

    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <Card
      className={`hover:border-primary/50 transition-colors ${disabled ? "opacity-50" : ""}`}
    >
      <CardContent className="p-5">
        <div
          className={`h-12 w-12 rounded-xl flex items-center justify-center ${iconBg} ${iconColor} mb-3`}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground mt-1 mb-3">
          {disabled && (!storeId || !date)
            ? "Önce mağaza ve tarih seç"
            : multiple
              ? "Birden fazla dosya seçilebilir"
              : "Bir dosya seç"}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          multiple={multiple}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Yükleniyor...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              Yükle
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
