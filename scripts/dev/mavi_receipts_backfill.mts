/**
 * Geçmiş Mavi SAP bayi dosyalarından FİŞLERİ doldurur (hediye çeki denetiminin
 * dayanağı). Yalnız okur + MaviReceipt'e yazar; başka hiçbir şeye dokunmaz.
 *
 *   node --env-file=.env --env-file=.env.local --conditions=react-server \
 *     --import ./scripts/dev/stub-hooks.mjs --import tsx scripts/dev/mavi_receipts_backfill.mts
 */
import { prisma } from "@/lib/prisma";
import { downloadFromStorage } from "@/server/services/storage";
import { parseMaviSapBuffer } from "@/server/services/dealer-report/mavi-sap-parser";

const ups = await prisma.upload.findMany({
  where: {
    type: "dealer_daily_report",
    status: { not: "failed" },
    daily_record: { store: { brand: { name: { contains: "mavi", mode: "insensitive" } } } },
  },
  select: { id: true, file_url: true, daily_record: { select: { store_id: true, date: true, store: { select: { name: true } } } } },
  orderBy: { uploaded_at: "asc" },
});
console.log(`${ups.length} Mavi bayi dosyası bulundu`);

let files = 0, rows = 0, failed = 0;
for (const u of ups) {
  try {
    const buf = await downloadFromStorage(u.file_url);
    const report = parseMaviSapBuffer(buf);
    const data = report.receipts
      .filter((r) => r.ref)
      .map((r) => ({
        store_id: u.daily_record.store_id,
        store_code: report.store_code,
        date: r.date,
        ref: r.ref,
        net_amount: r.net,
        is_refund: r.is_refund,
        line_count: r.line_count,
        upload_id: u.id,
      }));
    const res = await prisma.maviReceipt.createMany({ data, skipDuplicates: true });
    files++;
    rows += res.count;
    if (files % 10 === 0) console.log(`  ${files}/${ups.length} dosya · ${rows} yeni fiş`);
  } catch (e) {
    failed++;
    console.error(`  HATA ${u.daily_record.store.name} ${u.daily_record.date.toISOString().slice(0, 10)}:`, e instanceof Error ? e.message : e);
  }
}
const total = await prisma.maviReceipt.count();
console.log(`\nbitti: ${files} dosya okundu, ${failed} hata, ${rows} yeni fiş · tabloda toplam ${total}`);
await prisma.$disconnect();
