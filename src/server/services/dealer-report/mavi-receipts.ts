import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { ParsedDealerReport } from "./mavi-sap-parser";

/**
 * SAP bayi dosyasındaki FİŞLERİ kalıcı yazar (hediye çeki denetiminin
 * dayanağı). `ref` = Referans No = Mavi bilgi fişindeki Fatura No = fişin
 * altındaki barkod.
 *
 * Aynı fiş birkaç dosyada geçebilir (bir fiş kendi gününden sonraki bir
 * dosyada da çıkıyor) → (mağaza, ref) üzerinde upsert. Yükleme asla bu
 * yüzden başarısız olmaz; çağıran yer hatayı yutar.
 */
export async function saveMaviReceipts(
  prisma: PrismaClient,
  opts: { storeId: string; report: ParsedDealerReport; uploadId?: string | null }
): Promise<{ saved: number }> {
  const rows = opts.report.receipts;
  if (rows.length === 0) return { saved: 0 };
  let saved = 0;
  // Sıralı ve küçük parçalar hâlinde: tek dosyada ~100-250 fiş var.
  for (const r of rows) {
    if (!r.ref) continue;
    await prisma.maviReceipt.upsert({
      where: { store_id_ref: { store_id: opts.storeId, ref: r.ref } },
      create: {
        store_id: opts.storeId,
        store_code: opts.report.store_code,
        date: r.date,
        ref: r.ref,
        net_amount: r.net,
        is_refund: r.is_refund,
        line_count: r.line_count,
        upload_id: opts.uploadId ?? null,
      },
      update: {
        date: r.date,
        net_amount: r.net,
        is_refund: r.is_refund,
        line_count: r.line_count,
      },
    });
    saved++;
  }
  return { saved };
}
