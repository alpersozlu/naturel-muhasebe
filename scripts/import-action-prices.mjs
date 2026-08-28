/**
 * Dalga aksiyon fiyatlarını Excel'den içe aktarır (Derimod "kırmızı etiket").
 *
 * İKİ DOSYA DÜZENİNİ de okur:
 *   A) Mağaza başına ayrı dosya, kurallar "KIRMIZI ETİKET BASILACAKLAR"
 *      sayfasında (04 Ağustos dalgası):
 *        node scripts/import-action-prices.mjs --date 2026-08-04 \
 *          S01=~/Desktop/Lefkosa_Dalga_Aksiyon_04Agu.xlsx \
 *          S02=~/Desktop/Magusa_Dalga_Aksiyon_04Agu.xlsx \
 *          S03=~/Desktop/Girne_Dalga_Aksiyon_04Agu.xlsx
 *
 *   B) Tek dosya, her mağaza kendi sayfasında (29 Temmuz etiket yenileme):
 *        node scripts/import-action-prices.mjs --date 2026-07-29 \
 *          --by-sheet ~/Desktop/Etiket_Yenileme_29Tem.xlsx
 *
 * Sütunlar başlık ADINDAN bulunur (sıra dosyadan dosyaya değişiyor):
 *   MODEL KODU · RENK · RENK ADI · GRUP · ÜST FİYAT · İNDİRİMLİ FİYAT
 *
 * "OUTLET'E TAŞINACAKLAR" sayfası BİLEREK okunmaz: o ürünler "BÜYÜK YAZ
 * İNDİRİMİ" kademeli çift kampanyasına girer ve fiş bazında denetlenir
 * (bkz. SUMMER_LADDER — nebimSales.ts), satır bazlı sabit fiyatla değil.
 *
 * Batch idempotent: aynı (mağaza, tarih) kapsamı silinip yeniden yazılır.
 */
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import os from "node:os";
import path from "node:path";

const prisma = new PrismaClient();
const RULE_SHEET = "KIRMIZI ETİKET BASILACAKLAR";

/** Sayfa adından mağaza kodu (B düzeni). TR karakterler katlanır. */
const SHEET_TO_STORE = [
  [/lefko/i, "S01"],
  [/magusa|mağusa/i, "S02"],
  [/girne/i, "S03"],
];
const storeCodeFromSheet = (name) => {
  const n = String(name).replace(/ğ/g, "g").replace(/ş/g, "s");
  for (const [re, code] of SHEET_TO_STORE) if (re.test(n)) return code;
  return null;
};

/** Başlık satırından sütun indeksleri — sıra dosyadan dosyaya değişiyor. */
function columnMap(headerRow) {
  const cells = [];
  headerRow.eachCell({ includeEmpty: true }, (c, i) => {
    cells[i] = String(c.value ?? "").trim().toLocaleUpperCase("tr");
  });
  const findCol = (pred) => {
    for (let i = 1; i < cells.length; i++) if (cells[i] && pred(cells[i])) return i;
    return null;
  };
  return {
    code: findCol((h) => h.includes("MODEL")),
    // "RENK ADI" değil, salt "RENK" olan sütun renk KODUdur.
    color: findCol((h) => h === "RENK") ?? findCol((h) => h.startsWith("RENK") && !h.includes("ADI")),
    name: findCol((h) => h.includes("ÜRÜN")),
    group: findCol((h) => h.includes("GRUP")),
    list: findCol((h) => h.includes("ÜST")),
    expected: findCol((h) => h.includes("İNDİRİMLİ") || h.includes("INDIRIMLI")),
  };
}

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
  const dateArg = args.indexOf("--date");
  const effective = dateArg >= 0 ? args[dateArg + 1] : null;
  if (!effective || !/^\d{4}-\d{2}-\d{2}$/.test(effective)) {
    console.error("HATA: --date YYYY-MM-DD zorunlu (aksiyonun yürürlük tarihi).");
    process.exit(1);
  }
  const bySheetIdx = args.indexOf("--by-sheet");
  const bySheetFile = bySheetIdx >= 0 ? expand(args[bySheetIdx + 1]) : null;
  const pairs = args
    .filter((a) => a.includes("=") && !a.startsWith("--"))
    .map((a) => {
      const i = a.indexOf("=");
      return [a.slice(0, i), expand(a.slice(i + 1))];
    });
  if (!bySheetFile && pairs.length === 0) {
    console.error("HATA: ya S01=dosya.xlsx eşleşmeleri ya da --by-sheet dosya.xlsx ver.");
    process.exit(1);
  }

  const batch = `dalga-${effective}`;
  const effectiveDate = new Date(`${effective}T00:00:00.000Z`);

  /** nebim_store_code → store_id (satış satırlarından çözülür). */
  const storeCache = new Map();
  const resolveStore = async (code) => {
    if (storeCache.has(code)) return storeCache.get(code);
    const row = await prisma.nebimSaleLine.findFirst({
      where: { nebim_store_code: code, store_id: { not: null } },
      select: { store_id: true, store_name_raw: true },
    });
    storeCache.set(code, row ?? null);
    return row ?? null;
  };

  /** Bir sayfayı kurallara çevirir (başlık adlarına göre). */
  const readSheet = (ws, storeId) => {
    const header = ws.getRow(1);
    const col = columnMap(header);
    if (col.code == null || col.expected == null) return null;
    const out = [];
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const at = (n) => (n == null ? null : row.getCell(n).value);
      const code = at(col.code);
      if (!code) return;
      const expected = trNumber(at(col.expected));
      if (expected == null) return;
      out.push({
        store_id: storeId,
        item_code: String(code).trim(),
        color_code: String(at(col.color) ?? "").trim(),
        product_name: at(col.name) ? String(at(col.name)).trim() : null,
        group_label: String(at(col.group) ?? "").trim() || "—",
        list_price: trNumber(at(col.list)),
        expected_price: expected,
        effective_from: effectiveDate,
        batch,
      });
    });
    return out;
  };

  /** Aynı (mağaza, tarih) kapsamını silip yeniden yaz — idempotent. */
  const write = async (storeId, rows, label) => {
    const deduped = Array.from(
      new Map(rows.map((r) => [`${r.item_code}|${r.color_code}`, r])).values()
    );
    await prisma.$transaction([
      prisma.nebimActionPrice.deleteMany({
        where: { store_id: storeId, effective_from: effectiveDate },
      }),
      prisma.nebimActionPrice.createMany({ data: deduped }),
    ]);
    const dropped = rows.length - deduped.length;
    console.log(
      `  ✓ ${label}: ${deduped.length} kural` +
        (dropped > 0 ? ` (${dropped} yinelenen model+renk birleştirildi)` : "")
    );
    return deduped.length;
  };

  let total = 0;

  // ── B düzeni: tek dosya, mağaza başına sayfa ────────────────────────
  if (bySheetFile) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(bySheetFile);
    for (const ws of wb.worksheets) {
      if (/outlet/i.test(ws.name)) continue; // merdiven kampanyası — atla
      const code = storeCodeFromSheet(ws.name);
      if (!code) {
        console.error(`  ✗ "${ws.name}" sayfası bir mağazaya eşlenemedi, atlanıyor`);
        continue;
      }
      const store = await resolveStore(code);
      if (!store) {
        console.error(`  ✗ ${code}: mağaza eşleşmedi, atlanıyor`);
        continue;
      }
      const rows = readSheet(ws, store.store_id);
      if (!rows) {
        console.error(`  ✗ "${ws.name}": başlık sütunları tanınamadı`);
        continue;
      }
      total += await write(store.store_id, rows, `${code} ${store.store_name_raw} — ${ws.name}`);
    }
  }

  // ── A düzeni: mağaza başına dosya ───────────────────────────────────
  for (const [code, file] of pairs) {
    const store = await resolveStore(code);
    if (!store) {
      console.error(`  ✗ ${code}: mağaza eşleşmedi, atlanıyor (${file})`);
      continue;
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet(RULE_SHEET) ?? wb.worksheets.find((w) => !/outlet/i.test(w.name));
    if (!ws) {
      console.error(`  ✗ ${code}: kural sayfası bulunamadı (${file})`);
      continue;
    }
    const rows = readSheet(ws, store.store_id);
    if (!rows) {
      console.error(`  ✗ ${code}: başlık sütunları tanınamadı (${file})`);
      continue;
    }
    total += await write(
      store.store_id,
      rows,
      `${code} (${store.store_name_raw}) — ${path.basename(file)}`
    );
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
