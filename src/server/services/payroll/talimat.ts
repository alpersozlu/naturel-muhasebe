import "server-only";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { GARANTI_TGB_TEMPLATE_B64 } from "./garanti-template";

export type TalimatRow = {
  name: string; // talimattaki isim (büyük harf)
  branch_code: string | null;
  account_no: string | null;
  iban: string | null;
  amount: number;
};

/** "2026-09-16" → "16092026" (banka: GGAAYYYY, METİN) */
export function talimatDateText(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}${m}${y}`;
}

/** Dosya adı: "16 Eylul 2026 - Avans Talimat.xlsx" (Mert'in adlandırması, ASCII) */
export function talimatFileName(isoDate: string, kindLabel: string): string {
  const MONTHS = ["Ocak", "Subat", "Mart", "Nisan", "Mayis", "Haziran", "Temmuz", "Agustos", "Eylul", "Ekim", "Kasim", "Aralik"];
  const [y, m, d] = isoDate.split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y} - ${kindLabel} Talimat.xlsx`;
}

const DATA_COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"] as const;
const FIRST_DATA_ROW = 13;
const ROW_IZAHAT = "maaş ödemesi";
const BANKA_KODU = "62";

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
function cellStr(ref: string, style: string | undefined, text: string): string {
  return `<c r="${ref}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t xml:space="preserve">${escXml(text)}</t></is></c>`;
}
function cellNum(ref: string, style: string | undefined, v: number): string {
  return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${v}</v></c>`;
}
function cellEmpty(ref: string, style: string | undefined): string {
  return `<c r="${ref}"${style ? ` s="${style}"` : ""}/>`;
}
/** Sayısal metin → sayı hücresi (şube/hesap), değilse metin hücresi. */
function cellNumOrStr(ref: string, style: string | undefined, s: string): string {
  return /^\d{1,15}$/.test(s) ? cellNum(ref, style, Number(s)) : cellStr(ref, style, s);
}

/**
 * Garanti "TGB Yeni Maaş Dosyası" — bankanın GERÇEK şablonu üzerine yazılır
 * (garanti-template.ts: Naturel'in bankaya gönderdiği dosyadan kişi satırları
 * temizlenmiş hali). Biçimler, veri doğrulamaları, koşullu biçimler, N/O
 * listeleri, C sütunu açıklama formülleri ve 4991 hazır satır olduğu gibi
 * kalır; yalnız B7 (tarih), B4/B5 önbellek değerleri ve 13. satırdan itibaren
 * A..I hücreleri yazılır. XML düzeyinde çalışır — hiçbir kütüphane şablonu
 * yeniden üretmez, bankaya giden dosya şablonla birebir aynı kalır.
 */
export async function buildGarantiTalimatXlsx(rows: TalimatRow[], isoDate: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(Buffer.from(GARANTI_TGB_TEMPLATE_B64, "base64"));
  const sheetPath = "xl/worksheets/sheet1.xml";
  let sheet = await zip.file(sheetPath)!.async("string");

  // Şablonun 13. satırındaki stil kimlikleri (A..I) — yeni satırlar aynı biçimi alır.
  const row13 = sheet.match(/<row r="13"[^>]*>[\s\S]*?<\/row>/)?.[0] ?? "";
  const styleOf: Record<string, string | undefined> = {};
  for (const col of DATA_COLS) {
    styleOf[col] = row13.match(new RegExp(`<c r="${col}13"(?: s="(\\d+)")?`))?.[1];
  }

  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  const rowXml = new Map<number, string>();
  rows.forEach((r, i) => {
    const n = FIRST_DATA_ROW + i;
    const cells =
      cellStr(`A${n}`, styleOf.A, r.name) +
      cellEmpty(`B${n}`, styleOf.B) +
      cellStr(`C${n}`, styleOf.C, BANKA_KODU) +
      (r.branch_code ? cellNumOrStr(`D${n}`, styleOf.D, r.branch_code.trim()) : cellEmpty(`D${n}`, styleOf.D)) +
      (r.account_no ? cellNumOrStr(`E${n}`, styleOf.E, r.account_no.trim()) : cellEmpty(`E${n}`, styleOf.E)) +
      (r.iban ? cellStr(`F${n}`, styleOf.F, r.iban.replace(/\s+/g, "")) : cellEmpty(`F${n}`, styleOf.F)) +
      cellNum(`G${n}`, styleOf.G, round2(r.amount)) +
      cellStr(`H${n}`, styleOf.H, ROW_IZAHAT) +
      cellStr(`I${n}`, styleOf.I, ROW_IZAHAT);
    rowXml.set(n, cells);
  });

  // Var olan satırları yerinde değiştir: A..I yenisi, J.. şablondan.
  const lastRow = FIRST_DATA_ROW + rows.length - 1;
  const seen = new Set<number>();
  sheet = sheet.replace(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g, (whole, rStr: string, attrs: string, inner: string) => {
    const r = Number(rStr);
    const cells = rowXml.get(r);
    if (!cells) return whole;
    seen.add(r);
    const rest = inner.match(/<c r="[J-Q]\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)?.join("") ?? "";
    const attr = attrs.replace(/ spans="[^"]*"/, "") + ' spans="1:17"';
    return `<row r="${r}"${attr}>${cells}${rest}</row>`;
  });
  // Şablonda bulunmayan satırlar (4991'den sonra) — sona eklenir.
  const missing: string[] = [];
  for (let r = FIRST_DATA_ROW; r <= lastRow; r++) {
    if (!seen.has(r)) missing.push(`<row r="${r}" spans="1:17" ht="15">${rowXml.get(r)}</row>`);
  }
  if (missing.length) sheet = sheet.replace("</sheetData>", `${missing.join("")}</sheetData>`);

  // B7 ödeme tarihi (GGAAYYYY, metin), B4/B5 önbellek değerleri.
  sheet = sheet.replace(/<c r="B7"( s="\d+")?(?:\/>|[^>]*>[\s\S]*?<\/c>)/, (_m, s: string | undefined) =>
    cellStr("B7", s?.match(/\d+/)?.[0], talimatDateText(isoDate))
  );
  sheet = sheet.replace(/(<c r="B4"[^>]*><f>[^<]*<\/f><v>)[^<]*(<\/v>)/, `$1${rows.length}$2`);
  sheet = sheet.replace(/(<c r="B5"[^>]*><f>[^<]*<\/f><v>)[^<]*(<\/v>)/, `$1${total}$2`);
  zip.file(sheetPath, sheet);

  // Excel açılışta formülleri yeniden hesaplasın (B4/B5, C açıklamaları).
  const wbPath = "xl/workbook.xml";
  let wb = await zip.file(wbPath)!.async("string");
  wb = /<calcPr[^>]*\/>/.test(wb)
    ? wb.replace(/<calcPr([^>]*)\/>/, (m, a: string) => (a.includes("fullCalcOnLoad") ? m : `<calcPr${a} fullCalcOnLoad="1"/>`))
    : wb.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
  zip.file(wbPath, wb);

  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return Buffer.from(out);
}

/**
 * Nakit / Ziraat listesi — talimat dışı ödemeler için basit imza listesi.
 */
export async function buildCashListXlsx(
  title: string,
  rows: Array<{ name: string; store: string; amount: number; scope: string }>
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Liste");
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 13 };
  const head = ["#", "Çalışan", "Mağaza", "Tutar (₺)", "Kapsam", "İmza"];
  head.forEach((h, i) => {
    const c = ws.getCell(3, i + 1);
    c.value = h;
    c.font = { bold: true };
  });
  rows.forEach((r, i) => {
    const n = 4 + i;
    ws.getCell(n, 1).value = i + 1;
    ws.getCell(n, 2).value = r.name;
    ws.getCell(n, 3).value = r.store;
    ws.getCell(n, 4).value = round2(r.amount);
    ws.getCell(n, 5).value = r.scope;
  });
  const totalRow = 4 + rows.length;
  ws.getCell(totalRow, 2).value = "TOPLAM";
  ws.getCell(totalRow, 2).font = { bold: true };
  ws.getCell(totalRow, 4).value = { formula: `SUM(D4:D${totalRow - 1})`, result: round2(rows.reduce((s, r) => s + r.amount, 0)) };
  ws.getCell(totalRow, 4).font = { bold: true };
  ws.getColumn(2).width = 30;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 14;
  ws.getColumn(4).numFmt = "#,##0.00";
  ws.getColumn(5).width = 36;
  ws.getColumn(6).width = 18;
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/**
 * Eski bir TGB dosyasından çalışan hesap bilgilerini okur (13. satırdan
 * itibaren): isim, şube, hesap, IBAN. Yönetici "Hesapları talimattan
 * aktar" ile yükler; eşleme isimle yapılır.
 */
export async function parseGarantiTalimat(buf: Buffer): Promise<Array<{ name: string; branch_code: string | null; account_no: string | null; iban: string | null; amount: number | null }>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: Array<{ name: string; branch_code: string | null; account_no: string | null; iban: string | null; amount: number | null }> = [];
  ws.eachRow((row, n) => {
    if (n < FIRST_DATA_ROW) return;
    const name = cellText(row.getCell(1).value);
    if (!name) return;
    out.push({
      name,
      branch_code: cellText(row.getCell(4).value) || null,
      account_no: cellText(row.getCell(5).value) || null,
      iban: (cellText(row.getCell(6).value) || "").replace(/\s+/g, "") || null,
      amount: toNum(row.getCell(7).value),
    });
  });
  return out;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object" && "result" in v) return String((v as { result?: unknown }).result ?? "");
  if (typeof v === "object" && "richText" in v)
    return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
  return String(v).trim();
}
function toNum(v: ExcelJS.CellValue): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "result" in v && typeof (v as { result?: unknown }).result === "number")
    return (v as { result: number }).result;
  // Metin: Türkçe biçim ("4.222,19") veya düz ("4222.19")
  const raw = cellText(v);
  const t = /,\d{1,2}$/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) && t !== "" ? n : null;
}
