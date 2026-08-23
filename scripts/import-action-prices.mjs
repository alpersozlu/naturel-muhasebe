/**
 * Dalga aksiyon fiyatlarını Excel'den içe aktarır (Derimod "kırmızı etiket").
 *
 * Kullanım:
 *   node scripts/import-action-prices.mjs --date 2026-08-04 \
 *     S01=~/Desktop/Lefkosa_Dalga_Aksiyon_04Agu.xlsx \
 *     S02=~/Desktop/Magusa_Dalga_Aksiyon_04Agu.xlsx \
 *     S03=~/Desktop/Girne_Dalga_Aksiyon_04Agu.xlsx
 *
 * Beklenen sayfa: "KIRMIZI ETİKET BASILACAKLAR"
 *   MODEL KODU | ÜRÜN ADI | RENK | RENK ADI | ADET | YENİ ÜST FİYAT | YENİ İNDİRİMLİ | GRUP
 *
 * "OUTLET'E TAŞINACAKLAR" sayfası BİLEREK okunmaz: o ürünler "BÜYÜK YAZ
 * İNDİRİMİ" kademeli çift kampanyasına girer ve fiş bazında denetlenir
 * (bkz. SUMMER_LADDER — nebimSales.ts), satır bazlı sabit fiyatla değil.
 *
 * Batch idempotent: aynı (mağaza, model, renk, tarih) tekrar çalıştırılırsa
 * güncellenir, kopya oluşmaz.
 */
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import os from "node:os";
import path from "node:path";

const prisma = new PrismaClient();
const SHEET = "KIRMIZI ETİKET BASILACAKLAR";

/** "6.699,99" ve "1.499,99 (OUTLET reyonu)" → 6699.99 / 1499.99 */
function trNumber(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  const cleaned = String(raw).split("(")[0].trim().replace(/\./g, "").replace(",", ".");
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

const expand = (p) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);

async function main() {
  const args = process.argv.slice(2);
  const dateArg = args.find((a) => a === "--date");
  const effective = dateArg ? args[args.indexOf("--date") + 1] : null;
  if (!effective || !/^\d{4}-\d{2}-\d{2}$/.test(effective)) {
    console.error("HATA: --date YYYY-MM-DD zorunlu (aksiyonun yürürlük tarihi).");
    process.exit(1);
  }
  const pairs = args.filter((a) => a.includes("=")).map((a) => {
    const i = a.indexOf("=");
    return [a.slice(0, i), expand(a.slice(i + 1))];
  });
  if (pairs.length === 0) {
    console.error("HATA: en az bir S01=dosya.xlsx eşleşmesi ver.");
    process.exit(1);
  }

  const batch = `dalga-${effective}`;
  const effectiveDate = new Date(`${effective}T00:00:00.000Z`);
  let total = 0;

  for (const [storeCode, file] of pairs) {
    const storeRow = await prisma.nebimSaleLine.findFirst({
      where: { nebim_store_code: storeCode, store_id: { not: null } },
      select: { store_id: true, store_name_raw: true },
    });
    if (!storeRow?.store_id) {
      console.error(`  ✗ ${storeCode}: mağaza eşleşmedi, atlanıyor (${file})`);
      continue;
    }

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet(SHEET);
    if (!ws) {
      console.error(`  ✗ ${storeCode}: "${SHEET}" sayfası yok (${file})`);
      continue;
    }

    const rows = [];
    ws.eachRow((row, i) => {
      if (i === 1) return; // başlık
      const cell = (n) => row.getCell(n).value;
      const itemCode = cell(1);
      if (!itemCode) return;
      const expected = trNumber(cell(7));
      if (expected == null) return;
      rows.push({
        store_id: storeRow.store_id,
        item_code: String(itemCode).trim(),
        color_code: String(cell(3) ?? "").trim(),
        product_name: cell(2) ? String(cell(2)).trim() : null,
        group_label: String(cell(8) ?? "").trim() || "—",
        list_price: trNumber(cell(6)),
        expected_price: expected,
        effective_from: effectiveDate,
        batch,
      });
    });

    // Toplu yaz: uzak DB'de satır-satır upsert dakikalarca sürüyor.
    // Aynı (mağaza, tarih) kapsamını silip yeniden yazmak idempotent kalır.
    // Aynı model+renk sayfada iki kez geçebiliyor — unique ihlalini önlemek
    // için son satır kazanır.
    const deduped = Array.from(
      new Map(rows.map((r) => [`${r.item_code}|${r.color_code}`, r])).values()
    );
    await prisma.$transaction([
      prisma.nebimActionPrice.deleteMany({
        where: { store_id: storeRow.store_id, effective_from: effectiveDate },
      }),
      prisma.nebimActionPrice.createMany({ data: deduped }),
    ]);
    if (deduped.length !== rows.length) {
      console.log(`    (${rows.length - deduped.length} yinelenen model+renk birleştirildi)`);
    }
    total += deduped.length;
    console.log(`  ✓ ${storeCode} (${storeRow.store_name_raw}): ${rows.length} kural — ${path.basename(file)}`);
  }

  const inDb = await prisma.nebimActionPrice.count({ where: { batch } });
  console.log(`\nBatch "${batch}": ${total} satır işlendi · DB'de ${inDb} kayıt.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
