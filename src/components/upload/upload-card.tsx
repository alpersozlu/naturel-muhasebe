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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result: "data:image/png;base64,XXXX..."
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
        const base64 = await fileToBase64(file);
        await create.mutateAsync({
          store_id: storeId,
          date,
          type,
          filename: file.name,
          mime_type: file.type as (typeof ACCEPTED_MIME_TYPES)[number],
          file_base64: base64,
        });
        ok++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`${file.name}: ${msg}`);
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
