import "server-only";
import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import {
  buildUploadPath,
  uploadBufferToStorage,
} from "@/server/services/storage";
import { parseCorporateReceipt } from "./parsers/corporate-receipt";

/** Girilen tutar ile fişteki tutar arasında kabul edilen fark (₺). */
const AMOUNT_TOLERANCE = 0.5;

function fmt(n: number): string {
  return n.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Kurumsal/yönetim alışverişinin bilgi fişini yükler, OKUR ve girilen tutarla
 * karşılaştırır. Tutmuyorsa kayıt hiç oluşmaz — hata fırlatılır.
 *
 * OCR burada SENKRON çalışır (diğer yüklemelerin aksine): tutar doğrulanmadan
 * alışveriş kaydı yazılmamalı, dolayısıyla arka plana atılamaz.
 *
 * @returns oluşturulan Upload kaydının id'si
 */
export async function ingestCorporateReceipt(opts: {
  prisma: PrismaClient;
  userId: string;
  storeId: string;
  dailyRecordId: string;
  amount: number;
  base64: string;
  mimeType: string;
}): Promise<string> {
  const buffer = Buffer.from(opts.base64, "base64");
  const file_hash = createHash("sha256").update(buffer).digest("hex");

  // Aynı fiş iki ayrı alışverişe sayılmasın.
  const dup = await opts.prisma.upload.findFirst({
    where: {
      type: "corporate_receipt",
      file_hash,
      status: { not: "failed" },
    },
    select: { uploaded_at: true },
  });
  if (dup) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Bu fiş daha önce yüklenmiş (${dup.uploaded_at.toLocaleString(
        "tr-TR"
      )}). Her alışveriş için kendi fişi gerekir.`,
    });
  }

  // Önce OKU — depolamaya yazmadan önce tutarı doğrula ki hatalı fiş
  // ortalıkta dosya bırakmasın.
  let parsed;
  try {
    const r = await parseCorporateReceipt({
      buffer,
      mimeType: opts.mimeType,
    });
    parsed = r.parsed;
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Fiş okunamadı. Fişin tamamı kadrajda ve net olacak şekilde tekrar çekip deneyin.",
    });
  }

  if (!parsed.is_receipt) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        parsed.rejection_reason ??
        "Yüklenen görsel bir Mavi bilgi fişi değil. Alışverişin bilgi fişini yükleyin.",
    });
  }

  if (parsed.payable_total == null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Fişteki 'Ödenecek Tutar' okunamadı. Fişin alt kısmı net görünecek şekilde tekrar çekin.",
    });
  }

  const diff = Math.abs(parsed.payable_total - opts.amount);
  if (diff > AMOUNT_TOLERANCE) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        `Girilen tutar (${fmt(opts.amount)} ₺) fişteki Ödenecek Tutar ile ` +
        `(${fmt(parsed.payable_total)} ₺) uyuşmuyor. ` +
        `Fark: ${fmt(diff)} ₺. Doğru tutarı girin ya da doğru fişi yükleyin.`,
    });
  }

  const path = buildUploadPath({
    storeId: opts.storeId,
    dailyRecordId: opts.dailyRecordId,
    type: "corporate_receipt",
    mimeType: opts.mimeType,
  });
  await uploadBufferToStorage({ path, buffer, mimeType: opts.mimeType });

  const upload = await opts.prisma.upload.create({
    data: {
      daily_record_id: opts.dailyRecordId,
      type: "corporate_receipt",
      file_url: path,
      file_hash,
      mime_type: opts.mimeType,
      file_size_bytes: buffer.length,
      uploaded_by: opts.userId,
      // Tutar doğrulandığı için doğrudan onaylı: ayrıca elle onay beklemez.
      status: "confirmed",
      parsed_data_json: parsed,
    },
  });
  return upload.id;
}
