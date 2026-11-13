import "server-only";
import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import {
  buildUploadPath,
  uploadBufferToStorage,
} from "@/server/services/storage";
import { parseCorporateReceipt } from "./parsers/corporate-receipt";
import { matchReceiptAmount, type ReceiptMatch } from "@/lib/corporate-receipt-match";

/**
 * Kurumsal/yönetim alışverişinin bilgi fişini yükler, OKUR ve girilen tutarla
 * karşılaştırır. Tutmuyorsa kayıt hiç oluşmaz — hata fırlatılır.
 *
 * OCR burada SENKRON çalışır (diğer yüklemelerin aksine): tutar doğrulanmadan
 * alışveriş kaydı yazılmamalı, dolayısıyla arka plana atılamaz.
 *
 * Ödeme bölünmüşse (kısmı nakit = yönetim/kurumsal, kısmı kişinin kartı)
 * girilen tutar fişin NAKİT satırıyla karşılaştırılır.
 *
 * @returns oluşturulan Upload kaydının id'si + eşleşmenin türü
 */
export async function ingestCorporateReceipt(opts: {
  prisma: PrismaClient;
  userId: string;
  storeId: string;
  dailyRecordId: string;
  amount: number;
  base64: string;
  mimeType: string;
}): Promise<{ uploadId: string; match: Extract<ReceiptMatch, { ok: true }>; payable_total: number }> {
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

  const match = matchReceiptAmount({
    amount: opts.amount,
    payable_total: parsed.payable_total,
    payments: parsed.payments,
  });
  if (!match.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: match.message });
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
      parsed_data_json: { ...parsed, matched: match.kind },
    },
  });
  return { uploadId: upload.id, match, payable_total: parsed.payable_total };
}
