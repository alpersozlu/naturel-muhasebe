import "server-only";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { normalizeName } from "./nebim-revenue";
import { isSapOriginal, xlsxOrigin, type XlsxOrigin } from "@/server/services/xlsx-origin";
import type { DailyRepMonth } from "@/server/services/dealer-report/daily-reps";

/**
 * Ay sonu performans belgeleri (Mavi mağazaları) — BELİRLENİMCİ okuma.
 *
 * Üç kaynak, üç ayrı SAP ekranından gelir; birbirini doğrular:
 *   bi_pdf     BI "Çalışan Performans Raporu" PDF — sayfa "ÇALIŞAN SATIŞ KPI"
 *              (kişi Net TL, UPT, tekli işlem…) + "ÇALIŞAN KATEGORİ KPI"
 *              (kategori ADET; Erkek 8 sütun, Kadın 10 sütun, Toplam)
 *   kpi_xlsx   "Personel KPI Raporu" — kişi × kategori TL ve ADET
 *              (denim = Erkek-Denim + Kadın-Denim). Excel olarak da, o Excel'in
 *              PDF'e çevrilmiş hâli olarak da gelir (Lefkoşa, Eylül 2026) —
 *              ikisi de aynı türdür (parseKpiPdfPages).
 *   itpos_kpi  IT POS "Performans" KPI dışa aktarımı — mağaza Net Ciro, UPT…
 *   itpos_reps IT POS satış temsilcisi tablosu — kişi Net ciro (kuruşlu)
 *
 * Mert'in yöntemi (Ağustos 2026): kişi toplamı = SAP kişi Net ciro, denim =
 * KPI dosyası, denim dışı = fark (çocuk/sweatshirt KPI'da yok, ND'ye düşer).
 * Yapay zekâ kullanılmaz: xlsx başlıktan, PDF sekmeli metinden okunur.
 *
 * BAĞIMSIZ KONTROL (03.10.2026). Bu üç belge de ay sonunda, mağazadan gelir.
 * Aynı Net Ciro, ay boyunca HER AKŞAM yüklenip kilitlenen günlük bayi gün
 * sonu dosyalarından da kurulur (dealer-report/daily-reps.ts): kişi başına
 * Σ Stok KDV Matrahı − Kartuş payı. Eylül 2026 Girne'de dört asistan ve
 * mağaza toplamı ay sonu belgeleriyle kuruşu kuruşuna aynı çıktı. Günler tam
 * ve fark 250 ₺'yi aşıyorsa aktarım durur; günler eksikse yalnız uyarır.
 *
 * İKİ SAP RAKAMI (05.10.2026, Lefkoşa Eylül). Bir fişte birden çok satış
 * temsilcisi varsa ve fişin bir kısmı Kartuş'la ödendiyse:
 *   • BI raporu Kartuş'u herkese payı oranında yazar (= günlük dosyalardan
 *     hesaplanan net_ciro; kişiler toplamı mağaza cirosunu tutar),
 *   • IT POS kişi tablosu yalnız İLK OKUTULAN ürünün temsilcisinden düşer;
 *     diğerlerinin payı kimseden düşülmez → o kişiler yüksek görünür, kişiler
 *     toplamı mağaza cirosunu AŞAR.
 * Günlük dosyalar her kişi için bu fazlayı da verir (itpos_extra), böylece
 * IT POS belgesi kuruşu kuruşuna doğrulanır. Bordroya mağaza cirosuyla TUTAN
 * rakam (pay oranlı) alınır — emsal: Girne Eylül 2026, Emre A.: IT POS
 * 1.227.594,53 · BI 1.227.557 → 1.227.557,03 alındı (sahibiyle, 03.10.2026).
 * Ayrıntı ve kanıt: dealer-report/mavi-sap-parser.ts "TWO SAP FIGURES".
 *
 * Denim ayrımı günlük dosyadan kesin ÇIKMAZ (ürün grubu kolonu yok) — prim
 * KPI dosyasındaki denim tutarıyla ödenir. Ama ürün adından bir TAHMİN çıkar
 * (mavi-sap-parser.ts looksLikeDenim); KPI tutarı bu tahminden çok saparsa
 * uyarı verilir. Denim oranı denim dışının üç katı olduğu için önemlidir.
 */
export const MAVI_STORE_CODE_BY_KEY: Record<string, string> = {
  lefkosa: "9400",
  girne: "9401",
  magusa: "9402",
  guzelyurt: "9403",
};

export function expectedStoreCode(storeName: string, brandName: string): string | null {
  if (!/mavi/i.test(brandName)) return null;
  const n = normalizeName(storeName);
  for (const [key, code] of Object.entries(MAVI_STORE_CODE_BY_KEY)) if (n.includes(key)) return code;
  return null;
}

export type PerfKind = "bi_pdf" | "kpi_xlsx" | "itpos_kpi" | "itpos_reps";

export type BiPerson = {
  code: string;
  name: string;
  net_tl: number | null;
  upt: number | null;
  sepet: number | null;
  two_plus_one_pct: number | null;
  single_pct: number | null;
  transactions: number | null;
  denim_units: number | null;
  units_total: number | null;
  erkek_denim_units: number | null;
  kadin_denim_units: number | null;
  /** Çocuk reyonu denim adedi (kategori sayfası; reyon yoksa 0). Eski kayıtlarda alan yoktur. */
  cocuk_denim_units?: number | null;
};
export type BiPdfParsed = {
  kind: "bi_pdf";
  store_code: string | null;
  persons: BiPerson[];
  total: Omit<BiPerson, "code" | "name">;
  category_layout_ok: boolean;
  /** Belgede hangi sayfalar vardı — rapor iki ayrı PDF olarak da gelir (Lefkoşa, Eylül 2026). Eski kayıtlarda yok. */
  has_sales?: boolean;
  has_category?: boolean;
  /** Raporun kendi süzgecinde yazan ay / yıl (okunabildiyse) */
  month?: number | null;
  year?: number | null;
};
export type KpiPerson = {
  code: string | null;
  name: string;
  denim_tl_erkek: number;
  denim_tl_kadin: number;
  denim_units_erkek: number;
  denim_units_kadin: number;
  category_tl_total: number;
  units_total: number;
};
export type KpiParsed = {
  kind: "kpi_xlsx";
  store_code: string | null;
  store_label: string | null;
  persons: KpiPerson[];
  /** Belgenin kendi üstünde yazan tarih süzgeci (yalnız PDF'te okunur) — YYYY-MM-DD */
  date_from?: string | null;
  date_to?: string | null;
  /** Kaynak biçimi; eski kayıtlarda yoktur (= xlsx) */
  format?: "xlsx" | "pdf";
};
export type ItPosKpiParsed = {
  kind: "itpos_kpi";
  net_ciro: number | null;
  units: number | null;
  invoices: number | null;
  sepet: number | null;
  upt: number | null;
  single_invoices: number | null;
  single_pct: number | null;
  two_plus_one_pct: number | null;
};
export type ItPosRepsParsed = { kind: "itpos_reps"; persons: Array<{ name: string; net_ciro: number; units: number | null; invoices: number | null }> };
export type PerfParsed = BiPdfParsed | KpiParsed | ItPosKpiParsed | ItPosRepsParsed;

export type PerfMeta = XlsxOrigin;

/** "1.038.234" · "2,63" · "2.414,5" · "19,8%" · "%43" · "4.057.009,16 TRY" → sayı */
export function trNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v).replace(/[^\d.,-]/g, "");
  if (!t || t === "-") return null;
  let n: number;
  if (t.includes(",")) n = Number(t.replace(/\./g, "").replace(",", "."));
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) n = Number(t.replace(/\./g, ""));
  else n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const pctOf = (v: string | undefined) => {
  const n = trNum(v);
  return n == null ? null : n / 100;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** xlsx üstverisi: gerçek SAP dışa aktarımı "SAP UI5" izini taşır; Excel'de kaydedilince değişir. */
const xlsxMeta = xlsxOrigin;

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object" && "result" in v) return String((v as { result?: unknown }).result ?? "");
  if (typeof v === "object" && "richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
  return String(v).trim();
}

function splitRep(label: string): { name: string; code: string | null } {
  // "Maral Rahmanova (94010020)" veya "94010020 - Maral Rahmanova"
  const a = label.match(/^(.*?)\s*\((\d{6,10})\)\s*$/);
  if (a) return { name: a[1]!.trim(), code: a[2]! };
  const b = label.match(/^(\d{6,10})\s*-\s*(.+)$/);
  if (b) return { name: b[2]!.trim(), code: b[1]! };
  return { name: label.trim(), code: null };
}

async function parseXlsx(buf: Buffer): Promise<PerfParsed> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Excel dosyasında sayfa yok");
  const header: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, col) => {
    header[col] = cellText(c.value);
  });
  const h = header.map((x) => normalizeName(x ?? ""));
  const find = (label: string) => h.findIndex((x) => x === normalizeName(label));

  // IT POS KPI: A1 "KPI", B1 "Değer"
  if (h[1] === "kpi" && (h[2] ?? "").startsWith("deger")) {
    const map = new Map<string, string>();
    ws.eachRow((row, n) => {
      if (n === 1) return;
      map.set(normalizeName(cellText(row.getCell(1).value)), cellText(row.getCell(2).value));
    });
    const get = (label: string) => map.get(normalizeName(label));
    return {
      kind: "itpos_kpi",
      net_ciro: trNum(get("Net Ciro")),
      units: trNum(get("Net Ürün Adedi")),
      invoices: trNum(get("Net Fatura Adedi")),
      sepet: trNum(get("Sepet TL")),
      upt: trNum(get("UPT")),
      single_invoices: trNum(get("Tek Adetli Fatura Sayısı")),
      single_pct: pctOf(get("Tek Adetli Fatura Oranı")),
      two_plus_one_pct: pctOf(get("2+1 li Fatura Oranı")),
    };
  }

  const repCol = find("Satış temsilcisi");
  // Personel KPI: "Erkek-Denim(TL)" başlığı
  const eDenimTl = find("Erkek-Denim(TL)");
  if (repCol > 0 && eDenimTl > 0) {
    const kDenimTl = find("Kadın-Denim(TL)");
    const eDenimU = find("Erkek-Denim(ADET)");
    const kDenimU = find("Kadın-Denim(ADET)");
    const storeCol = find("Mağaza");
    const tlCols: number[] = [];
    const unitCols: number[] = [];
    header.forEach((label, col) => {
      if (!label || /toplam/i.test(label)) return;
      if (/\(TL\)\s*$/.test(label)) tlCols.push(col);
      if (/\(ADET\)\s*$/.test(label)) unitCols.push(col);
    });
    const persons: KpiPerson[] = [];
    let store_label: string | null = null;
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const rep = cellText(row.getCell(repCol).value);
      if (!rep) return;
      if (storeCol > 0 && !store_label) store_label = cellText(row.getCell(storeCol).value) || null;
      const num = (col: number) => (col > 0 ? (trNum(row.getCell(col).value as unknown) ?? 0) : 0);
      const { name, code } = splitRep(rep);
      persons.push({
        code,
        name,
        denim_tl_erkek: r2(num(eDenimTl)),
        denim_tl_kadin: r2(num(kDenimTl)),
        denim_units_erkek: num(eDenimU),
        denim_units_kadin: num(kDenimU),
        category_tl_total: r2(tlCols.reduce((s, c) => s + num(c), 0)),
        units_total: unitCols.reduce((s, c) => s + num(c), 0),
      });
    });
    const label: string | null = store_label;
    const store_code = label ? ((label as string).match(/\((\d{4})\)/)?.[1] ?? null) : (persons.find((p) => p.code)?.code?.slice(0, 4) ?? null);
    return { kind: "kpi_xlsx", store_code, store_label: label, persons };
  }

  // IT POS satış temsilcisi tablosu: "Satış temsilcisi" + "Net ciro"
  const netCol = find("Net ciro");
  if (repCol > 0 && netCol > 0) {
    const unitCol = find("Net adet");
    const invCol = find("Fatura adedi");
    const persons: ItPosRepsParsed["persons"] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const rep = cellText(row.getCell(repCol).value);
      const net = trNum(row.getCell(netCol).value as unknown);
      if (!rep || net == null) return;
      persons.push({
        name: splitRep(rep).name,
        net_ciro: r2(net),
        units: unitCol > 0 ? trNum(row.getCell(unitCol).value as unknown) : null,
        invoices: invCol > 0 ? trNum(row.getCell(invCol).value as unknown) : null,
      });
    });
    return { kind: "itpos_reps", persons };
  }
  throw new Error(
    "Dosya tanınmadı. Beklenen: IT POS Performans (KPI/Değer), Personel KPI Raporu (Satış temsilcisi + Erkek-Denim(TL)) veya IT POS satış temsilcisi tablosu (Satış temsilcisi + Net ciro)."
  );
}

const EMPTY_TOTAL: BiPdfParsed["total"] = {
  net_tl: null,
  upt: null,
  sepet: null,
  two_plus_one_pct: null,
  single_pct: null,
  transactions: null,
  denim_units: null,
  units_total: null,
  erkek_denim_units: null,
  kadin_denim_units: null,
};

/**
 * pdf-parse → pdf.js, loaded ON DEMAND and never at module top level.
 *
 * OUTAGE 03.10.2026 (18:16 → 19:29): this file imported pdf-parse at the top.
 * Every tRPC call shares this module graph, so when pdf.js could not load on
 * Vercel the WHOLE API answered "500 <!DOCTYPE…" — while the local production
 * build worked. Two things pdf.js expects under Node are simply not in a
 * serverless bundle:
 *
 *  1. `DOMMatrix`. pdf.js runs `new DOMMatrix()` while its module loads and
 *     borrows the class from the native "@napi-rs/canvas" package, which it
 *     requires through a computed path the bundler cannot follow. Only page
 *     RENDERING uses it; text extraction never does, so a stand-in class is
 *     enough to let the module load.
 *  2. The worker. pdf.js looks for "pdf.worker.mjs" as a sibling FILE at run
 *     time. Importing it here by its literal name puts it in the bundle and
 *     registers it on globalThis.pdfjsWorker, so no file lookup happens.
 *     (pdfjs-dist is pinned in package.json to the version pdf-parse uses.)
 *
 * `appRouter.healthPdf` runs pdfSelfTest() — the same loader on a PDF built
 * in memory — so a deploy can be checked from outside without signing in.
 */
class DOMMatrixStandIn {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  is2D = true;
  isIdentity = true;
  scaleSelf() {
    return this;
  }
  translateSelf() {
    return this;
  }
  multiplySelf() {
    return this;
  }
  preMultiplySelf() {
    return this;
  }
  invertSelf() {
    return this;
  }
  translate() {
    return this;
  }
  scale() {
    return this;
  }
}

async function loadPdfParse() {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.DOMMatrix === "undefined") g.DOMMatrix = DOMMatrixStandIn;
  if (!g.pdfjsWorker) await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return (await import("pdf-parse")).PDFParse;
}

/** A one-page PDF with a single line of text — offsets computed, no file needed. */
function tinyPdf(text: string): Uint8Array {
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/** Can this server read a PDF at all? Never throws. */
export async function pdfSelfTest(): Promise<{ ok: boolean; ms: number; error: string | null; positions: boolean }> {
  const t0 = Date.now();
  try {
    // Asıl okuyucunun yolu: metin + (BI kategori sayfası için) parça konumları.
    const pages = await pdfPages(Buffer.from(tinyPdf("NATUREL PDF OK 1234")));
    const text = pages.map((p) => p.text).join(" ");
    const positions = pages.some((p) => p.items.some((i) => i.s.includes("NATUREL") && i.x > 0 && i.y > 0));
    if (!text.includes("NATUREL PDF OK 1234")) return { ok: false, ms: Date.now() - t0, error: `metin okunamadı: "${text.slice(0, 60)}"`, positions };
    return { ok: true, ms: Date.now() - t0, error: null, positions };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: (e instanceof Error ? e.message : String(e)).slice(0, 300), positions: false };
  }
}

/** Sayfadaki bir metin parçası ve konumu (PDF birimi; y yukarı doğru artar). */
export type PdfItem = { s: string; x: number; y: number; w: number };
type PdfPage = { text: string; items: PdfItem[] };

async function pdfPages(buf: Buffer): Promise<PdfPage[]> {
  const PDFParse = await loadPdfParse();
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const res = await parser.getText();
    // Konumlar: pdf-parse belgeyi (pdf.js) dışarı vermez; getText'in de kullandığı iç `load()`
    // ile aynı belgeye erişilir (sürüm sabit: pdf-parse 2.4.5). Erişilemezse sayfalar yalnız
    // metinle döner ve okuyucular metin yoluna düşer — hata vermez.
    type Doc = { getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }> };
    const load = (parser as unknown as { load?: () => Promise<Doc> }).load;
    let doc: Doc | null = null;
    try {
      doc = typeof load === "function" ? await load.call(parser) : null;
    } catch {
      doc = null;
    }
    const pages: PdfPage[] = [];
    for (const p of (res.pages ?? []) as Array<{ text: string; num: number }>) {
      let items: PdfItem[] = [];
      try {
        const content = doc ? await (await doc.getPage(p.num)).getTextContent() : { items: [] };
        for (const it of content.items as Array<{ str?: string; transform?: number[]; width?: number }>) {
          if (typeof it.str !== "string" || !it.str.trim() || !it.transform) continue;
          items.push({ s: it.str.trim(), x: it.transform[4] ?? 0, y: it.transform[5] ?? 0, w: it.width ?? 0 });
        }
      } catch {
        items = []; // konum okunamazsa metinle devam edilir
      }
      pages.push({ text: p.text, items });
    }
    return pages;
  } finally {
    await parser.destroy?.();
  }
}

// ── Personel KPI Raporu, PDF hâli ───────────────────────────────────────────

// Sayı sütunu başlığı "<Grup>-<Kategori>(TL|ADET)" biçimindedir ("Erkek-Ceket Mont(TL)",
// "Kadın-T-Shirt(ADET)"): tek kelime + tire ile başlamak ZORUNDA — yoksa soldaki
// tanınmayan bir metin sütunu başlığın içine yutulur ve hizalama sessizce kayar.
const KPI_LABEL =
  /Para birimi|Satış temsilcisi|Mağaza adı|Mağaza|Mal Grubu Hiyerarşisi|Sezon|Tarih \(UTC\)|[A-Za-zÇĞİÖŞÜçğıöşü]+-[^()]*?\((?:TL|ADET)\)|[A-Za-zÇĞİÖŞÜçğıöşü]+(?: [A-Za-zÇĞİÖŞÜçğıöşü]+)?\((?:TL|ADET)\)/g;
const KPI_METRIC = /\((TL|ADET)\)$/;
const KPI_CURRENCY = /^(TRY|TL|USD|EUR|GBP)$/;
const KPI_NUMBER = /^-?\d[\d.,]*$/;

/**
 * "Personel KPI Raporu" Excel'i PDF'e çevrilince geniş tablo SÜTUN SÜTUN
 * sayfalara bölünür (Lefkoşa, Eylül 2026: 21 sayfa). Her sayfanın ilk satırı o
 * sayfaya düşen sütun başlıklarıdır, altındaki satırlar hep aynı sırayla aynı
 * kişilerdir:
 *
 *   s.1  Mağaza · Mağaza adı · Satış temsilcisi (kod)
 *   s.2  Satış temsilcisi (ad) · Erkek-Denim(TL) · Para birimi · Erkek-Denim(ADET)
 *   s.4  Erkek-Gömlek(TL) · Para birimi · Erkek-Gömlek(ADET) · Erkek-Non-Denim(TL)
 *   s.5  Para birimi · Erkek-Non-Denim(ADET) · …            ← üçlü sayfaya bölünebilir
 *   s.21 Teknik bilgiler · Tarih 01.09.2026 …30.09.2026     ← belgenin dönemi
 *
 * Hücreler boşlukla ayrılır; sayı sütunlarında boş hücre olmaz, bu yüzden her
 * satırdaki değer sayısı sayfadaki sütun sayısına eşit olmalıdır — değilse
 * (ya da tanınmayan bir başlık varsa) tahmin yürütülmez, hata verilir.
 * Sayılar belgenin yerel ayarına göre "1,724.13" ya da "1.724,13" yazılır;
 * hangisi olduğu TL sütunlarından anlaşılır. Yapay zekâ yok — saf metin.
 */
export function parseKpiPdfPages(pages: string[]): KpiParsed {
  const columns = new Map<string, string[]>(); // başlık → satır satır ham değer
  let names: string[] = [];
  const codes: Array<string | null> = [];
  let store_code: string | null = null;
  let store_label: string | null = null;
  let date_from: string | null = null;
  let date_to: string | null = null;

  pages.forEach((text, idx) => {
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    const pageNo = idx + 1;
    // Belgenin dönemi: "Tarih 01.09.2026 03:00:00...30.09.2026 03:00:00"
    for (const l of lines) {
      const d = l.match(/^Tarih\s+(\d{2})\.(\d{2})\.(\d{4}).*?(\d{2})\.(\d{2})\.(\d{4})/);
      if (d) {
        date_from = `${d[3]}-${d[2]}-${d[1]}`;
        date_to = `${d[6]}-${d[5]}-${d[4]}`;
      }
    }
    const header = lines[0]!;
    const labels: string[] = header.match(KPI_LABEL) ?? [];
    const body = lines.slice(1);
    const metrics = labels.filter((l) => KPI_METRIC.test(l));

    // Kod sayfası: Mağaza · Mağaza adı · Satış temsilcisi (sayı sütunu yok)
    if (metrics.length === 0) {
      if (labels[0] === "Mağaza" && labels.includes("Satış temsilcisi") && codes.length === 0) {
        for (const l of body) {
          const m = l.match(/^(\d{4})\s+(.*?)(?:\s+(\d{6,10}))?$/);
          if (!m) continue;
          store_code = store_code ?? m[1]!;
          store_label = store_label ?? m[2]!.trim();
          codes.push(m[3] ?? null);
        }
      }
      return;
    }
    if (header.replace(KPI_LABEL, "").trim() !== "") {
      throw new Error(`KPI PDF'inin ${pageNo}. sayfasında tanınmayan sütun başlığı var: "${header.replace(KPI_LABEL, "").trim()}" — raporu Excel olarak yükleyin.`);
    }
    const hasName = labels[0] === "Satış temsilcisi";
    const valueLabels = hasName ? labels.slice(1) : labels;
    const pageNames: string[] = [];
    for (const l of body) {
      const tokens = l.split(/\s+/);
      let cut = 0;
      if (hasName) {
        while (cut < tokens.length && !KPI_NUMBER.test(tokens[cut]!) && !KPI_CURRENCY.test(tokens[cut]!)) cut += 1;
        pageNames.push(tokens.slice(0, cut).join(" "));
      }
      const values = tokens.slice(cut);
      if (values.length !== valueLabels.length) {
        throw new Error(
          `KPI PDF'inin ${pageNo}. sayfasında bir satırdaki değer sayısı (${values.length}) sütun sayısını (${valueLabels.length}) tutmuyor — raporu Excel olarak yükleyin.`
        );
      }
      valueLabels.forEach((label, i) => {
        if (!KPI_METRIC.test(label)) return; // "Para birimi"
        const col = columns.get(label) ?? [];
        col.push(values[i]!);
        columns.set(label, col);
      });
    }
    if (hasName) names = names.concat(pageNames);
  });

  const eTl = columns.get("Erkek-Denim(TL)");
  const kTl = columns.get("Kadın-Denim(TL)");
  if (!eTl || !kTl) throw new Error("PDF'te Erkek-Denim(TL) / Kadın-Denim(TL) sütunları bulunamadı — bu bir Personel KPI Raporu mu?");
  const n = names.length;
  if (n === 0) throw new Error("KPI PDF'inde satış temsilcisi adları okunamadı — raporu Excel olarak yükleyin.");
  for (const [label, col] of Array.from(columns.entries())) {
    if (col.length !== n) throw new Error(`KPI PDF'inde "${label}" sütununda ${col.length} satır var, ${n} kişi bekleniyordu — raporu Excel olarak yükleyin.`);
  }

  // Sayı biçimi: TL sütunları hep iki ondalıklıdır → ayırıcı oradan anlaşılır.
  const tlSample = Array.from(columns.entries())
    .filter(([label]) => /\(TL\)$/.test(label))
    .flatMap(([, col]) => col);
  const dotDecimal = tlSample.filter((t) => /\.\d{2}$/.test(t)).length;
  const commaDecimal = tlSample.filter((t) => /,\d{2}$/.test(t)).length;
  if (dotDecimal > 0 && commaDecimal > 0) throw new Error("KPI PDF'inde sayı biçimi karışık (hem 1,234.56 hem 1.234,56) — raporu Excel olarak yükleyin.");
  const english = dotDecimal >= commaDecimal;
  const num = (t: string | undefined): number => {
    if (!t) return 0;
    const v = Number(english ? t.replace(/,/g, "") : t.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(v)) throw new Error(`KPI PDF'inde sayı okunamadı: "${t}"`);
    return v;
  };

  const tlLabels = Array.from(columns.keys()).filter((l) => /\(TL\)$/.test(l) && !/toplam/i.test(l));
  const unitLabels = Array.from(columns.keys()).filter((l) => /\(ADET\)$/.test(l) && !/toplam/i.test(l));
  const eU = columns.get("Erkek-Denim(ADET)");
  const kU = columns.get("Kadın-Denim(ADET)");
  const useCodes = codes.length === n;
  const persons: KpiPerson[] = [];
  for (let i = 0; i < n; i++) {
    const name = names[i]!.trim();
    if (!name) continue;
    persons.push({
      code: useCodes ? codes[i]! : null,
      name,
      denim_tl_erkek: r2(num(eTl[i])),
      denim_tl_kadin: r2(num(kTl[i])),
      denim_units_erkek: num(eU?.[i]),
      denim_units_kadin: num(kU?.[i]),
      category_tl_total: r2(tlLabels.reduce((s, l) => s + num(columns.get(l)![i]), 0)),
      units_total: unitLabels.reduce((s, l) => s + num(columns.get(l)![i]), 0),
    });
  }
  if (persons.length === 0) throw new Error("KPI PDF'inde kişi satırı bulunamadı.");
  return { kind: "kpi_xlsx", store_code, store_label, persons, date_from, date_to, format: "pdf" };
}

type BiCategoryRow = { units_total: number | null; erkek_denim_units: number; kadin_denim_units: number; cocuk_denim_units: number };

/**
 * BI "ÇALIŞAN KATEGORİ KPI" sayfası — KONUMLA okunur.
 *
 * Tablo reyon reyon adet verir: Erkek (… Denim …, Toplam) · Kadın (…) · varsa
 * Çocuk (…) · en sağda genel Toplam. Hangi sütunların göründüğü mağazaya göre
 * değişir (Girne'de Erkek-Ceket ve Çocuk reyonu yok; Lefkoşa'da ikisi de var)
 * ve BOŞ HÜCRE METİNDE HİÇ YER TUTMAZ — sıradan sayarak okumak, bir hücresi boş
 * olan satırda (çoğu satır) yanlış sütuna düşer. Bu yüzden her sayı, başlık
 * satırındaki en yakın sütun başlığına bağlanır. Güvence: her reyonda
 * kalemlerin toplamı reyon Toplam'ına, reyon toplamları genel Toplam'a eşit
 * çıkmalıdır; çıkmayan satırın denim adedi YAZILMAZ (ok = false).
 */
export function parseBiCategoryGrid(items: PdfItem[]): { rows: Map<string, BiCategoryRow & { name: string }>; total: BiCategoryRow | null; ok: boolean } {
  const rows = new Map<string, BiCategoryRow & { name: string }>();
  const empty = { rows, total: null, ok: false };
  // Satırlar: y'si birbirine yakın parçalar
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfItem[][] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0]!.y - it.y) <= 4) last.push(it);
    else lines.push([it]);
  }
  for (const l of lines) l.sort((a, b) => a.x - b.x);
  const header = lines.find((l) => l.some((i) => i.s === "Çalışan") && l.filter((i) => i.s === "Toplam").length >= 2);
  const sectionLine = lines.find((l) => l.some((i) => i.s === "Bölüm"));
  if (!header || !sectionLine) return empty;
  const center = (i: PdfItem) => i.x + i.w / 2;
  const nameX = header.find((i) => i.s === "Çalışan")!.x;
  const sectionNames = sectionLine.filter((i) => i.s !== "Bölüm" && i.s !== "Toplam").map((i) => i.s);
  const grand = sectionLine.filter((i) => i.s === "Toplam").pop();
  type Col = { label: string; cx: number; section: number; grand: boolean };
  const cols: Col[] = [];
  let section = 0;
  for (const h of header.filter((i) => i.x > nameX)) {
    cols.push({ label: h.s, cx: center(h), section, grand: false });
    if (h.s === "Toplam") section += 1;
  }
  const sectionCount = section;
  if (sectionCount < 2 || !grand || grand.x <= cols[cols.length - 1]!.cx) return empty;
  cols.push({ label: "Toplam", cx: center(grand), section: -1, grand: true });
  const sectionOf = (name: string) => sectionNames.findIndex((n) => normalizeName(n) === name);
  const iE = sectionOf("erkek");
  const iK = sectionOf("kadin");
  const iC = sectionOf("cocuk");
  if (sectionNames.length !== sectionCount || iE < 0 || iK < 0) return empty;
  // İki sütun arasının yarısından uzağa düşen sayı hiçbir sütuna ait sayılmaz.
  const gaps = cols.slice(1).map((c, i) => c.cx - cols[i]!.cx);
  const reach = Math.min(...gaps) / 2;

  let ok = true;
  let total: BiCategoryRow | null = null;
  for (const line of lines) {
    const first = line[0]!;
    const m = first.s.match(/^(\d{8})\s*-\s*(.+)$/);
    const isTotal = first.s === "Genel Toplam";
    if (!m && !isTotal) continue;
    const values = new Map<Col, number>();
    let clean = true;
    for (const it of line.slice(1)) {
      if (!/^-?[\d.]+$/.test(it.s)) continue;
      const v = trNum(it.s);
      const col = cols.reduce((a, b) => (Math.abs(b.cx - center(it)) < Math.abs(a.cx - center(it)) ? b : a));
      if (v == null || Math.abs(col.cx - center(it)) > reach || values.has(col)) {
        clean = false;
        break;
      }
      values.set(col, v);
    }
    const grandValue = values.get(cols[cols.length - 1]!) ?? null;
    let sum = 0;
    for (let sIdx = 0; clean && sIdx < sectionCount; sIdx++) {
      const sc = cols.filter((c) => c.section === sIdx);
      const parts = sc.filter((c) => c.label !== "Toplam").reduce((a, c) => a + (values.get(c) ?? 0), 0);
      const tot = values.get(sc.find((c) => c.label === "Toplam")!);
      if ((tot ?? 0) !== parts) clean = false;
      sum += tot ?? 0;
    }
    if (clean && grandValue !== sum) clean = false;
    const denim = (sIdx: number) => (sIdx < 0 ? 0 : (values.get(cols.find((c) => c.section === sIdx && c.label === "Denim")!) ?? 0));
    const row: BiCategoryRow = clean
      ? { units_total: grandValue, erkek_denim_units: denim(iE), kadin_denim_units: denim(iK), cocuk_denim_units: denim(iC) }
      : { units_total: grandValue, erkek_denim_units: NaN, kadin_denim_units: NaN, cocuk_denim_units: NaN };
    if (!clean) ok = false;
    if (isTotal) total = row;
    else rows.set(m![1]!, { ...row, name: m![2]!.trim() });
  }
  return { rows, total, ok: ok && rows.size > 0 };
}

const TR_MONTHS = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];

/**
 * BI sayfasının süzgeç kutuları: "Tarih" başlığının hemen altında ay adı, "Yıl"
 * başlığının altında yıl yazar. Konumla okunur (ay adları kişi adı da olabilir:
 * Eylül, Nisan…); konum yoksa sayfada TEK ay adı ve TEK yıl geçiyorsa o alınır.
 * Emin olunamıyorsa null — dönem denetimi yapılmaz, yanlış ret verilmez.
 */
function biReportPeriod(pg: PdfPage): { month: number; year: number } | null {
  const below = (label: string) => {
    const h = pg.items.find((i) => i.s === label);
    if (!h) return null;
    return (
      pg.items
        .filter((i) => i !== h && i.y < h.y && h.y - i.y < 70 && Math.abs(i.x - h.x) < 40)
        .sort((a, b) => b.y - a.y)[0]?.s ?? null
    );
  };
  const m = TR_MONTHS.indexOf(normalizeName(below("Tarih") ?? ""));
  const y = below("Yıl");
  if (m >= 0 && y && /^20\d{2}$/.test(y)) return { month: m + 1, year: Number(y) };
  const words = pg.text.split(/\s+/).filter(Boolean);
  const months = Array.from(new Set(words.map((w) => TR_MONTHS.indexOf(normalizeName(w))).filter((i) => i >= 0)));
  const years = Array.from(new Set(words.filter((w) => /^20\d{2}$/.test(w)).map(Number)));
  return months.length === 1 && years.length === 1 ? { month: months[0]! + 1, year: years[0]! } : null;
}

/** Belgede hangi sayfalar var (eski kayıtlarda bayrak yoktur — içerikten anlaşılır). */
export function biPdfPagesOf(p: BiPdfParsed): { sales: boolean; category: boolean } {
  return {
    sales: p.has_sales ?? (p.total.net_tl != null || p.persons.some((x) => x.net_tl != null)),
    category: p.has_category ?? (p.total.units_total != null || p.persons.some((x) => x.units_total != null)),
  };
}

/**
 * Rapor iki ayrı PDF olarak gelebilir (her sayfa ayrı yazdırılmış: biri SATIŞ
 * KPI, biri KATEGORİ KPI). Sistemde mağaza × ay başına TEK BI kaydı durur;
 * ikinci dosya birincinin üstüne yazmaz, eksik sayfasını tamamlar. Yeni dosyada
 * bulunan sayfa yeni dosyadan, bulunmayan sayfa eldeki kayıttan alınır.
 */
export function mergeBiPdf(prev: BiPdfParsed, next: BiPdfParsed): BiPdfParsed {
  const a = biPdfPagesOf(prev);
  const b = biPdfPagesOf(next);
  const pick = <T extends Omit<BiPerson, "code" | "name">>(p: T | undefined, n: T | undefined): Omit<BiPerson, "code" | "name"> => {
    const sales = b.sales ? n : p;
    const cat = b.category ? n : p;
    return {
      net_tl: sales?.net_tl ?? null,
      upt: sales?.upt ?? null,
      sepet: sales?.sepet ?? null,
      two_plus_one_pct: sales?.two_plus_one_pct ?? null,
      single_pct: sales?.single_pct ?? null,
      transactions: sales?.transactions ?? null,
      denim_units: sales?.denim_units ?? null,
      units_total: cat?.units_total ?? null,
      erkek_denim_units: cat?.erkek_denim_units ?? null,
      kadin_denim_units: cat?.kadin_denim_units ?? null,
      cocuk_denim_units: cat?.cocuk_denim_units ?? null,
    };
  };
  const codes = Array.from(new Set([...next.persons, ...prev.persons].map((x) => x.code)));
  return {
    kind: "bi_pdf",
    store_code: next.store_code ?? prev.store_code,
    persons: codes.map((code) => {
      const p = prev.persons.find((x) => x.code === code);
      const n = next.persons.find((x) => x.code === code);
      return { code, name: (n ?? p)!.name, ...pick(p, n) };
    }),
    total: pick(prev.total, next.total),
    category_layout_ok: b.category ? next.category_layout_ok : prev.category_layout_ok,
    has_sales: a.sales || b.sales,
    has_category: a.category || b.category,
    month: next.month ?? prev.month ?? null,
    year: next.year ?? prev.year ?? null,
  };
}

function parseBiPdf(pages: PdfPage[]): BiPdfParsed {
  const persons = new Map<string, BiPerson>();
  const total: BiPdfParsed["total"] = { ...EMPTY_TOTAL };
  let category_layout_ok = true;
  let has_sales = false;
  let has_category = false;
  let month: number | null = null;
  let year: number | null = null;
  const person = (code: string, name: string): BiPerson => {
    let p = persons.get(code);
    if (!p) {
      p = { code, name, ...EMPTY_TOTAL };
      persons.set(code, p);
    }
    return p;
  };

  const applySales = (t: Omit<BiPerson, "code" | "name">, cells: string[]) => {
    // [pay %, Net TL, UPT, Sepet, (2+1 %), (Tekli %), İşlem, (Denim adet), (Üst/Alt)] — boş hücreler metinde yok
    t.net_tl = trNum(cells[1]);
    t.upt = trNum(cells[2]);
    t.sepet = trNum(cells[3]);
    const rest = cells.slice(4);
    const pcts = rest.filter((c) => c.includes("%"));
    const nums = rest.filter((c) => !c.includes("%"));
    t.two_plus_one_pct = pcts.length >= 2 ? pctOf(pcts[0]) : null;
    t.single_pct = pcts.length ? pctOf(pcts[pcts.length - 1]) : null;
    t.transactions = nums.length ? trNum(nums[0]) : null;
    t.denim_units = nums.length >= 2 && !nums[1]!.includes(",") ? trNum(nums[1]) : null;
  };
  // Konum okunamadıysa: yalnız bütün hücreleri dolu 19 sütunlu satır (Girne düzeni) sıradan okunur.
  const applyCategoryText = (t: Omit<BiPerson, "code" | "name">, cells: string[]) => {
    const n = cells.map((c) => trNum(c) ?? 0);
    t.units_total = n.length ? n[n.length - 1]! : null;
    if (n.length === 19) {
      // Erkek: aksesuar, DENİM, gömlek, ND alt, penye, sweatshirt, triko, toplam · Kadın: aksesuar, ceket, DENİM, etek, gömlek, ND alt, penye, sweatshirt, triko, toplam · Toplam
      const erkekOk = n.slice(0, 7).reduce((a, b) => a + b, 0) === n[7];
      const kadinOk = n.slice(8, 17).reduce((a, b) => a + b, 0) === n[17];
      const totalOk = n[7]! + n[17]! === n[18];
      if (erkekOk && kadinOk && totalOk) {
        t.erkek_denim_units = n[1]!;
        t.kadin_denim_units = n[10]!;
      } else category_layout_ok = false;
    }
  };

  for (const pg of pages) {
    const isSales = /ÇALIŞAN SATIŞ KPI/.test(pg.text);
    const isCategory = /ÇALIŞAN KATEGORİ KPI/.test(pg.text);
    if (!isSales && !isCategory) continue;
    if (isSales) has_sales = true;
    if (isCategory) has_category = true;
    // Raporun dönemi: süzgeç kutularında yazar ("Tarih" altında ay adı, "Yıl" altında yıl).
    const period = biReportPeriod(pg);
    if (period) [month, year] = [period.month, period.year];

    const grid = isCategory ? parseBiCategoryGrid(pg.items) : null;
    if (grid && grid.rows.size > 0) {
      if (!grid.ok) category_layout_ok = false;
      const put = (t: Omit<BiPerson, "code" | "name">, r: BiCategoryRow) => {
        t.units_total = r.units_total;
        if (Number.isNaN(r.erkek_denim_units)) return; // toplamı tutmayan satır: denim adedi yazılmaz
        t.erkek_denim_units = r.erkek_denim_units;
        t.kadin_denim_units = r.kadin_denim_units;
        t.cocuk_denim_units = r.cocuk_denim_units;
      };
      for (const [code, r] of Array.from(grid.rows.entries())) put(person(code, r.name), r);
      if (grid.total) put(total, grid.total);
      continue;
    }
    for (const raw of pg.text.split("\n")) {
      const line = raw.trim();
      const m = line.match(/^(\d{8})\s*-\s*([^\t]+?)\s*\t(.+)$/);
      const g = line.match(/^Genel Toplam\s*\t(.+)$/);
      if (!m && !g) continue;
      const cells = (m ? m[3]! : g![1]!)
        .split("\t")
        .map((c) => c.trim())
        .filter(Boolean);
      const target = m ? person(m[1]!, m[2]!.trim()) : total;
      if (isSales) applySales(target, cells);
      else applyCategoryText(target, cells);
    }
  }
  if (persons.size === 0) {
    throw new Error("PDF tanınmadı. Beklenen: BI \"Çalışan Performans Raporu\" ya da PDF'e çevrilmiş \"Personel KPI Raporu\" (Erkek-Denim(TL) sütunlu).");
  }
  const codes = Array.from(persons.keys()).map((c) => c.slice(0, 4));
  const store_code = codes.sort((a, b) => codes.filter((x) => x === b).length - codes.filter((x) => x === a).length)[0] ?? null;
  return { kind: "bi_pdf", store_code, persons: Array.from(persons.values()), total, category_layout_ok, has_sales, has_category, month, year };
}

export async function parsePerformanceFile(
  fileName: string,
  buf: Buffer
): Promise<{ parsed: PerfParsed; meta: PerfMeta | null; genuine: boolean | null; hash: string; mime: string; ext: string }> {
  const isPdf = buf.subarray(0, 5).toString("latin1") === "%PDF-";
  const hash = sha256(buf);
  if (isPdf) {
    const pages = await pdfPages(buf);
    // Personel KPI Raporu'nun PDF hâli "Erkek-Denim(TL)" başlığını taşır; BI raporu taşımaz.
    const parsed = pages.some((p) => p.text.includes("Erkek-Denim(TL)")) ? parseKpiPdfPages(pages.map((p) => p.text)) : parseBiPdf(pages);
    return { parsed, meta: null, genuine: null, hash, mime: "application/pdf", ext: "pdf" };
  }
  const isZip = buf.subarray(0, 2).toString("latin1") === "PK";
  if (!isZip) throw new Error(`"${fileName}" Excel (.xlsx) veya PDF değil.`);
  const [parsed, meta] = await Promise.all([parseXlsx(buf), xlsxMeta(buf)]);
  const genuine = isSapOriginal(meta);
  return {
    parsed,
    meta,
    genuine,
    hash,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  };
}

// ── Çapraz kontrol ──────────────────────────────────────────────────────────

export type PerfLineRef = {
  line_id: string;
  employee_id: string;
  full_name: string;
  aliases: string[];
  bank_account_name: string | null;
  commission_profile: string;
  own_revenue_nd: number | null;
  own_revenue_denim: number | null;
  top_seller: boolean;
};

type Flag = { level: "error" | "warn" | "info"; text: string };

export type PerfPersonRow = {
  name: string;
  code: string | null;
  line_id: string | null;
  commission_profile: string | null;
  net_bi: number | null;
  net_itpos: number | null;
  /** ay boyunca yüklenen günlük bayi dosyalarından yeniden hesaplanan Net Ciro */
  net_daily: number | null;
  /**
   * IT POS kişi tablosunun bu kişide net_daily'nin ÜSTÜNDE göstermesi beklenen
   * tutar (ortak fişlerde düşülmeyen Kartuş payı). null = bilinmiyor.
   */
  itpos_extra: number | null;
  /** satış temsilcisi kodu girilmemiş satışların toplandığı satır (kişi değil) */
  uncoded: boolean;
  /** aktarımda kullanılacak toplam: IT POS (kuruşlu) → günlük dosyalar (tam ve BI ile aynıysa) → BI */
  net_used: number | null;
  net_used_source: "itpos" | "daily" | "bi" | null;
  /** bordro satırında şu an kayıtlı toplam ciro (denim + denim dışı) */
  line_total: number | null;
  denim_tl: number | null;
  /** günlük dosyalardan ürün adına göre TAHMİN edilen denim cirosu (yalnız akla yatkınlık kontrolü) */
  denim_daily_est: number | null;
  nd_tl: number | null;
  kpi_category_tl: number | null;
  denim_units_kpi: number | null;
  denim_units_bi: number | null;
  kadin_denim_units: number | null;
  upt: number | null;
  single_pct: number | null;
  flags: Flag[];
};

export type PerfDailySummary = {
  days_expected: number;
  days_present: number;
  days_missing: string[];
  month_over: boolean;
  complete: boolean;
  upload_days: number;
  archive_days: number;
  not_original_days: string[];
  store_net: number;
};

export type PerfCheck = {
  docs: PerfKind[];
  store_net: number | null;
  store_net_source: "itpos" | "bi" | "daily" | null;
  persons_sum: number | null;
  upt_itpos: number | null;
  upt_bi: number | null;
  single_pct_itpos: number | null;
  single_pct_bi: number | null;
  kadin_denim_units_store: number | null;
  denim_units_store: number | null;
  top_seller: string | null;
  /** günlük bayi dosyalarının ay özeti — bağımsız kontrol */
  daily: PerfDailySummary | null;
  /** günlük dosyalar ay sonu belgeleriyle karşılaştırılabildi ve tuttu */
  daily_agrees: boolean | null;
  rows: PerfPersonRow[];
  flags: Flag[];
  ready: boolean;
};

function matchLine(name: string, lines: PerfLineRef[]): PerfLineRef | null {
  const key = normalizeName(name);
  for (const l of lines) {
    const cands = [l.full_name, l.bank_account_name, ...l.aliases].filter(Boolean) as string[];
    if (cands.some((c) => normalizeName(c) === key)) return l;
  }
  const t = key.split(" ").filter(Boolean);
  if (t.length < 2) {
    // tek isim ("Funda"): ilk adı tek bir satırla eşleşiyorsa
    const hits = lines.filter((l) => normalizeName(l.full_name).split(" ")[0] === t[0]);
    return hits.length === 1 ? hits[0]! : null;
  }
  const hits = lines.filter((l) => {
    const et = normalizeName(l.full_name).split(" ").filter(Boolean);
    return et[0] === t[0] && (et.length === 1 || et[et.length - 1] === t[t.length - 1]);
  });
  if (hits.length === 1) return hits[0]!;
  // SAP'de "Fırat Öner", bordroda "Muhammet Fırat Öner": kısa adın bütün
  // kelimeleri uzun adda geçiyorsa ve tek aday varsa aynı kişidir.
  const sub = lines.filter((l) => {
    const et = normalizeName(l.full_name).split(" ").filter(Boolean);
    const [short, long] = t.length <= et.length ? [t, et] : [et, t];
    return short.length >= 2 && short.every((w) => long.includes(w));
  });
  return sub.length === 1 ? sub[0]! : null;
}

const TRY = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayList = (days: string[]) => {
  const d = days.map((x) => String(Number(x.slice(8, 10))));
  return d.length > 12 ? `${d.slice(0, 12).join(", ")} … (+${d.length - 12})` : d.join(", ");
};

/** Günlük dosyalarla ay sonu belgesi arasındaki fark bu tutarı aşarsa aktarım durur. */
const DAILY_ERROR_TL = 250;
/** Bu tutara kadar fark "aynı" sayılır (yuvarlama). */
const DAILY_SAME_TL = 1;
/**
 * Denim tahmini toleransı. Tahmin, KPI'daki gerçek denim tutarından ortalama
 * %1,7, en çok %6,3 saptı (11 kişi-ay; küçük cirolu kişide yüzde büyür) —
 * uyarı için hem %8 hem 10.000 ₺ aşılmalı.
 */
const DENIM_EST_TOL_SHARE = 0.08;
const DENIM_EST_TOL_TL = 10_000;
/** Satış temsilcisi kodu girilmemiş satışların satır adı. */
export const UNCODED_LABEL = "Temsilci kodu girilmemiş satış";

export function buildPerformanceCheck(docs: PerfParsed[], lines: PerfLineRef[], daily: DailyRepMonth | null = null): PerfCheck {
  const bi = docs.find((d): d is BiPdfParsed => d.kind === "bi_pdf");
  const kpi = docs.find((d): d is KpiParsed => d.kind === "kpi_xlsx");
  const itk = docs.find((d): d is ItPosKpiParsed => d.kind === "itpos_kpi");
  const itr = docs.find((d): d is ItPosRepsParsed => d.kind === "itpos_reps");
  const flags: Flag[] = [];
  const hasDaily = !!daily && daily.days_present > 0;
  const dailyComplete = !!daily && daily.complete;

  // Kişiler: önce satış temsilcisi koduyla, kod yoksa isimle birleştirilir.
  type Slot = {
    name: string;
    code: string | null;
    bi?: BiPerson;
    kpi?: KpiPerson;
    itpos?: ItPosRepsParsed["persons"][number];
    daily?: number;
    dailyDenim?: number | null;
    /** IT POS'un bu kişide düşmediği Kartuş payı; null = günlerden biri bilinmiyor */
    dailyExtra?: number | null;
    uncoded?: boolean;
  };
  const slots: Slot[] = [];
  const byCode = new Map<string, Slot>();
  const byName = new Map<string, Slot>();
  const slot = (name: string, code?: string | null) => {
    const k = normalizeName(name);
    const c = code && /^\d{6,10}$/.test(code) ? code : null;
    let s = (c ? byCode.get(c) : undefined) ?? byName.get(k);
    if (!s) {
      s = { name, code: c };
      slots.push(s);
    }
    if (c) {
      if (!s.code) s.code = c;
      if (!byCode.has(c)) byCode.set(c, s);
    }
    if (!byName.has(k)) byName.set(k, s);
    return s;
  };
  // Satış temsilcisi kodu girilmemiş satışlar: günlük dosyada kod "—" gelir, KPI
  // raporunda aynı ad kodsuz ikinci bir satır olarak görünür (Lefkoşa Eylül 2026:
  // "Sonuc Baloglu" kodsuz 1.724,13). Bir kişinin cirosu değildir; kendi satırında durur.
  let uncoded: Slot | null = null;
  const uncodedSlot = () => {
    if (!uncoded) {
      uncoded = { name: UNCODED_LABEL, code: null, uncoded: true };
      slots.push(uncoded);
    }
    return uncoded;
  };
  const kpiCodedNames = new Set((kpi?.persons ?? []).filter((p) => p.code).map((p) => normalizeName(p.name)));
  for (const p of bi?.persons ?? []) slot(p.name, p.code).bi = p;
  for (const p of kpi?.persons ?? []) {
    const s = !p.code && kpiCodedNames.has(normalizeName(p.name)) ? uncodedSlot() : slot(p.name, p.code);
    s.kpi = p;
  }
  for (const p of itr?.persons ?? []) slot(p.name).itpos = p;
  for (const p of hasDaily ? daily!.persons : []) {
    const s = /^\d{6,10}$/.test(p.code) ? slot(p.name, p.code) : uncodedSlot();
    s.daily = r2((s.daily ?? 0) + p.net_ciro);
    s.dailyDenim = s.dailyDenim === null || p.denim_est == null ? null : r2((s.dailyDenim ?? 0) + p.denim_est);
    s.dailyExtra = s.dailyExtra === null || p.itpos_extra == null ? null : r2((s.dailyExtra ?? 0) + p.itpos_extra);
  }

  const rows: PerfPersonRow[] = [];
  for (const s of slots) {
    const line = matchLine(s.name, lines);
    const net_bi = s.bi?.net_tl ?? null;
    const net_itpos = s.itpos?.net_ciro ?? null;
    // Günlük dosyalar varken kişinin hiç satırı yoksa günlük cirosu 0'dır.
    const net_daily = hasDaily ? (s.daily ?? 0) : null;
    const ref = net_itpos ?? net_bi; // ay sonu belgesindeki rakam
    // 1 ₺'ye kadar fark yuvarlamadır: BI tam liraya yuvarlar, Kartuş payı kuruşun altına iner.
    const refTol = DAILY_SAME_TL;
    // IT POS'un bu kişide düşmediği Kartuş payı (ortak fişler). Günlük dosya yoksa bilinmez.
    const itpos_extra = hasDaily ? (s.daily == null ? 0 : (s.dailyExtra ?? (s.dailyExtra === null ? null : 0))) : null;
    // Günlük dosyalardan beklenen IT POS rakamı = pay oranlı ciro + düşülmeyen pay.
    const itposExpected = net_daily != null && itpos_extra != null ? r2(net_daily + itpos_extra) : null;
    const itposConfirmed = net_itpos != null && dailyComplete && itposExpected != null && Math.abs(net_itpos - itposExpected) <= refTol;
    let net_used: number | null;
    let net_used_source: PerfPersonRow["net_used_source"];
    if (net_itpos != null) {
      // IT POS belgesi günlük dosyalarla doğrulandıysa ve ortak fiş fazlası içeriyorsa,
      // mağaza cirosuyla tutan pay oranlı rakam alınır (emsal: Emre A., 03.10.2026).
      if (itposConfirmed && (itpos_extra ?? 0) > 0.005) [net_used, net_used_source] = [net_daily, "daily"];
      else [net_used, net_used_source] = [net_itpos, "itpos"];
    } else if (net_bi != null) {
      // Günlük dosyalar tam ve BI ile aynı liradaysa kuruşlu olan günlük rakam kullanılır.
      if (dailyComplete && net_daily != null && Math.abs(net_daily - net_bi) <= 1) [net_used, net_used_source] = [net_daily, "daily"];
      else [net_used, net_used_source] = [net_bi, "bi"];
    } else if (dailyComplete && net_daily != null) [net_used, net_used_source] = [net_daily, "daily"];
    else [net_used, net_used_source] = [null, null];

    const denim_tl = s.kpi ? r2(s.kpi.denim_tl_erkek + s.kpi.denim_tl_kadin) : null;
    const rf: Flag[] = [];
    // IT POS ↔ BI: IT POS, ortak fişlerdeki Kartuş payını düşmediği kadar yüksek OLMALIDIR.
    const itposOnBiBasis = net_itpos != null ? r2(net_itpos - (itpos_extra ?? 0)) : null;
    if (net_bi != null && itposOnBiBasis != null && Math.abs(net_bi - itposOnBiBasis) > 1) {
      const gap = r2(net_itpos! - net_bi);
      rf.push({
        level: Math.abs(net_bi - itposOnBiBasis) > 250 ? "error" : "warn",
        text:
          `Kişi cirosu iki kaynakta farklı: IT POS ${TRY.format(net_itpos!)} · BI ${TRY.format(net_bi)} (fark ${TRY.format(gap)})` +
          (itpos_extra == null && gap > 0 ? " — IT POS, ortak fişlerde Kartuş payını yalnız ilk okutulan ürünün temsilcisinden düşer; günlük bayi dosyaları olmadan bu pay ayrılamaz" : ""),
      });
    }
    // Bağımsız kontrol: gün gün yüklenen bayi dosyalarının toplamı ↔ ay sonu belgesi.
    // IT POS belgesi için beklenen rakam, düşülmeyen Kartuş payını da içerir.
    const expected = net_itpos != null ? (itposExpected ?? net_daily) : net_daily;
    if (expected != null && ref != null && Math.abs(ref - expected) > refTol) {
      const diff = r2(ref - expected);
      const basis =
        net_itpos != null && (itpos_extra ?? 0) > 0.005
          ? `Günlük dosyalar ${TRY.format(net_daily!)} + IT POS'un düşmediği Kartuş payı ${TRY.format(itpos_extra!)} = ${TRY.format(expected)}`
          : `Günlük dosyalar ${TRY.format(expected)}`;
      if (dailyComplete) {
        rf.push({
          level: Math.abs(diff) > DAILY_ERROR_TL ? "error" : "warn",
          text: `${basis} · ay sonu belgesi ${TRY.format(ref)} (belge ${diff > 0 ? "+" : "−"}${TRY.format(Math.abs(diff))})`,
        });
      } else if (net_daily != null && net_daily > ref + refTol) {
        rf.push({
          level: "warn",
          text: `Günlük dosyalar eksik olduğu halde (${TRY.format(net_daily)}) ay sonu belgesinden (${TRY.format(ref)}) yüksek`,
        });
      }
    }
    // Denim: KPI dosyasındaki tutar ↔ günlük dosyalardan ürün adına göre tahmin.
    // Tahmin ±%3 civarında oynar; bu yüzden yalnız büyük sapmada ve yalnız UYARI.
    const denim_daily_est = hasDaily ? (s.dailyDenim ?? (s.daily == null ? 0 : null)) : null;
    if (dailyComplete && denim_tl != null && denim_daily_est != null) {
      const diff = r2(denim_tl - denim_daily_est);
      if (Math.abs(diff) > Math.max(DENIM_EST_TOL_TL, DENIM_EST_TOL_SHARE * Math.max(denim_tl, denim_daily_est))) {
        rf.push({
          level: "warn",
          text: `Denim tutarı (KPI ${TRY.format(denim_tl)}) günlük dosyalardan çıkan tahminden (≈ ${TRY.format(denim_daily_est)}) ${TRY.format(Math.abs(diff))} ${
            diff > 0 ? "yüksek" : "düşük"
          }`,
        });
      }
    }
    // Denim adedi: KPI raporu yalnız Erkek + Kadın reyonunu sayar; BI satış sayfasındaki
    // "Denim Adet" çocuk reyonunu da içerir (Lefkoşa Eylül 2026: Selbi 281 = 168 + 107 + 6).
    const duKpi = s.kpi ? s.kpi.denim_units_erkek + s.kpi.denim_units_kadin : null;
    const duBi = s.bi?.denim_units ?? null;
    const duKids = s.bi?.cocuk_denim_units ?? null; // BI kategori sayfası okunduysa
    if (duKpi != null && duBi != null && duBi !== duKpi + (duKids ?? 0)) {
      if (duKids == null && duBi > duKpi) {
        rf.push({
          level: "info",
          text: `BI denim adedi ${duBi}, KPI ${duKpi}: aradaki ${duBi - duKpi} adet çocuk denimi olabilir (KPI raporunda çocuk reyonu yok) — BI raporunun kategori sayfası yüklenince kesinleşir`,
        });
      } else {
        rf.push({ level: "error", text: `Denim adedi tutmuyor: KPI dosyası ${duKpi}${duKids ? ` + çocuk reyonu ${duKids}` : ""}, BI raporu ${duBi}` });
      }
    }
    // KPI raporunun TL sütunları IT POS tabanındadır: ortak fişte bu kişiden düşülmeyen Kartuş
    // payını içerir (Lefkoşa Eylül 2026, kasiyer: KPI toplamı = IT POS rakamı = 15.930,56;
    // pay oranlı ciro 15.814,29). Üst sınır bu yüzden IT POS tabanıyla karşılaştırılır.
    const kpiCeiling = net_used == null ? null : (net_itpos ?? r2(net_used + (itpos_extra ?? 0)));
    if (s.kpi && kpiCeiling != null && s.kpi.category_tl_total > kpiCeiling + 1) {
      rf.push({ level: "error", text: `KPI kategori toplamı (${TRY.format(s.kpi.category_tl_total)}) kişinin net cirosunu aşıyor` });
    } else if (s.kpi && net_used != null && net_used > 0 && (net_used - s.kpi.category_tl_total) / net_used > 0.1) {
      rf.push({
        level: "warn",
        text: `KPI kategori toplamı net cironun %${(((net_used - s.kpi.category_tl_total) / net_used) * 100).toFixed(1)} altında (çocuk/sweatshirt için beklenenden fazla)`,
      });
    }
    if (denim_tl != null && kpiCeiling != null && denim_tl > kpiCeiling + 1) rf.push({ level: "error", text: "Denim tutarı toplam cirodan büyük" });
    if (s.uncoded) {
      rf.push({ level: "info", text: "Satış temsilcisi kodu girilmemiş satış — mağaza cirosunda var, kimsenin kişisel cirosuna yazılmaz" });
    } else if (!line && (net_used ?? net_daily ?? 0) > 1000) rf.push({ level: "warn", text: "Bordroda eşleşen personel yok — takma ad ekleyin" });
    if (net_used_source === "daily" && net_itpos != null && (itpos_extra ?? 0) > 0.005) {
      rf.push({
        level: "info",
        text: `IT POS tablosu ${TRY.format(net_itpos)} gösterir: ortak fişlerde ${TRY.format(itpos_extra!)} ₺ Kartuş payı bu kişiden düşülmemiş. Mağaza cirosuyla tutan ${TRY.format(net_used!)} alındı`,
      });
    }
    const line_total = line && line.own_revenue_nd != null ? r2(line.own_revenue_nd + (line.own_revenue_denim ?? 0)) : null;
    if (line && line.commission_profile === "mavi_asistan" && net_used != null) {
      if (line_total == null) rf.push({ level: "info", text: "Bordroya henüz işlenmedi" });
      else if (Math.abs(line_total - net_used) >= 1) {
        rf.push({ level: "info", text: `Bordroda ${TRY.format(line_total)} kayıtlı — aktarınca ${TRY.format(net_used)} olur` });
      }
    }
    rows.push({
      name: s.name,
      code: s.code,
      line_id: line?.line_id ?? null,
      commission_profile: line?.commission_profile ?? null,
      net_bi,
      net_itpos,
      net_daily,
      itpos_extra,
      uncoded: !!s.uncoded,
      net_used,
      net_used_source,
      line_total,
      denim_tl,
      denim_daily_est,
      nd_tl: net_used != null && denim_tl != null ? r2(net_used - denim_tl) : null,
      kpi_category_tl: s.kpi?.category_tl_total ?? null,
      denim_units_kpi: duKpi,
      denim_units_bi: duBi,
      kadin_denim_units: s.kpi?.denim_units_kadin ?? s.bi?.kadin_denim_units ?? null,
      upt: s.bi?.upt ?? null,
      single_pct: s.bi?.single_pct ?? null,
      flags: rf,
    });
  }
  rows.sort((a, b) => (b.net_used ?? b.net_daily ?? 0) - (a.net_used ?? a.net_daily ?? 0));

  const persons_sum = rows.some((r) => r.net_used != null) ? r2(rows.reduce((s, r) => s + (r.net_used ?? 0), 0)) : null;
  const docStoreNet = itk?.net_ciro ?? bi?.total.net_tl ?? null;
  // BI mağaza toplamını tam liraya yuvarlar. Günlük dosyalar tam ve BI ile aynı liradaysa
  // kuruşlu günlük toplam alınır (Lefkoşa Eylül 2026: BI 5.691.599 · günlük 5.691.598,70 —
  // IT POS mağaza ekranı da 5.691.598,70 gösterir).
  const biAgreesToLira = itk?.net_ciro == null && bi?.total.net_tl != null && dailyComplete && Math.abs(bi.total.net_tl - daily!.store_net) <= DAILY_SAME_TL;
  const store_net = biAgreesToLira ? daily!.store_net : (docStoreNet ?? (dailyComplete ? daily!.store_net : null));
  const store_net_source: PerfCheck["store_net_source"] =
    itk?.net_ciro != null ? "itpos" : biAgreesToLira ? "daily" : bi?.total.net_tl != null ? "bi" : dailyComplete ? "daily" : null;

  if (itk?.net_ciro != null && bi?.total.net_tl != null && Math.abs(itk.net_ciro - bi.total.net_tl) > 5) {
    flags.push({
      level: "error",
      text: `Mağaza Net Ciro iki kaynakta farklı: IT POS ${TRY.format(itk.net_ciro)} · BI ${TRY.format(bi.total.net_tl)} — dönem (tarih aralığı) aynı mı?`,
    });
  }
  if (store_net != null && persons_sum != null && Math.abs(store_net - persons_sum) > 50) {
    flags.push({ level: "error", text: `Kişi ciroları toplamı (${TRY.format(persons_sum)}) mağaza Net Ciro'yu (${TRY.format(store_net)}) tutmuyor` });
  } else if (store_net != null && persons_sum != null && Math.abs(store_net - persons_sum) > 1) {
    flags.push({ level: "info", text: `Kişi toplamı ile mağaza Net Ciro arasında ${TRY.format(persons_sum - store_net)} ₺ küçük fark (yuvarlama)` });
  }

  // ── Günlük bayi dosyaları: bağımsız kontrol ───────────────────────────────
  let daily_agrees: boolean | null = null;
  if (daily) {
    if (!hasDaily) {
      flags.push({ level: "info", text: "Bu ayın günlük bayi gün sonu dosyaları sistemde yok — bağımsız kontrol yapılamadı" });
    } else {
      if (!daily.month_over) {
        flags.push({ level: "info", text: `Ay bitmedi — günlük bayi dosyaları ${daily.days_present} gün` });
      } else if (daily.days_missing.length) {
        flags.push({
          level: "warn",
          text: `Günlük bayi dosyası eksik: ${daily.days_missing.length} gün (ayın ${dayList(daily.days_missing)}. günü) — o günleri içeren bayi gün sonu Excel'ini "Belge yükle" ile ekleyin`,
        });
      }
      if (daily.not_original_days.length) {
        flags.push({
          level: "warn",
          text: `${daily.not_original_days.length} günün bayi dosyası SAP'nin özgün dışa aktarımı değil, Excel'de yeniden kaydedilmiş (ayın ${dayList(daily.not_original_days)}. günü)`,
        });
      }
      if (docStoreNet != null) {
        const tol = DAILY_SAME_TL;
        const diff = r2(docStoreNet - daily.store_net);
        if (Math.abs(diff) <= tol) {
          if (daily.complete) daily_agrees = true;
        } else if (daily.complete) {
          daily_agrees = false;
          flags.push({
            level: Math.abs(diff) > DAILY_ERROR_TL ? "error" : "warn",
            text: `Mağaza cirosu: günlük dosyaların toplamı ${TRY.format(daily.store_net)} · ay sonu belgesi ${TRY.format(docStoreNet)} (belge ${diff > 0 ? "+" : "−"}${TRY.format(Math.abs(diff))})`,
          });
        } else if (daily.store_net > docStoreNet + tol) {
          flags.push({
            level: "warn",
            text: `Günlük dosyalar eksik olduğu halde toplamı (${TRY.format(daily.store_net)}) ay sonu belgesindeki mağaza cirosundan (${TRY.format(docStoreNet)}) yüksek`,
          });
        }
      }
      if (daily_agrees === true && rows.some((r) => r.flags.some((f) => f.level !== "info" && f.text.startsWith("Günlük dosyalar")))) daily_agrees = false;
    }
  }

  if (bi && !bi.category_layout_ok) flags.push({ level: "warn", text: "BI raporunun kategori sayfası beklenen düzende değil — kadın/erkek denim adedi KPI dosyasından alındı" });
  if (!bi) {
    flags.push(
      dailyComplete
        ? { level: "info", text: "BI Çalışan Performans Raporu yüklenmedi — kişi ciroları günlük bayi dosyalarından alındı; denim adedi ikinci kaynakla doğrulanamadı" }
        : { level: "warn", text: "BI Çalışan Performans Raporu (PDF) yüklenmedi" }
    );
  }
  if (!kpi) flags.push({ level: "warn", text: "Personel KPI Raporu (xlsx) yüklenmedi — denim ayrımı yapılamaz" });
  if (!itk) {
    flags.push({
      level: "info",
      text: biAgreesToLira
        ? "IT POS Performans (KPI) yüklenmedi — mağaza cirosu günlük bayi dosyalarından alındı (kuruşlu); BI raporundaki toplamla aynı"
        : bi
          ? "IT POS Performans (KPI) yüklenmedi — mağaza cirosu BI raporundan alınır"
          : dailyComplete
            ? "IT POS Performans (KPI) yüklenmedi — mağaza cirosu günlük bayi dosyalarından alınır"
            : "IT POS Performans (KPI) yüklenmedi",
    });
  }
  for (const l of lines.filter((x) => x.commission_profile === "mavi_asistan")) {
    if (!rows.some((r) => r.line_id === l.line_id)) flags.push({ level: "warn", text: `${l.full_name} belgelerde yok` });
  }

  const asistans = rows.filter((r) => r.commission_profile === "mavi_asistan" && r.net_used != null);
  const top = asistans.length ? asistans.reduce((a, b) => ((b.net_used ?? 0) > (a.net_used ?? 0) ? b : a)) : null;
  const hasError = flags.some((f) => f.level === "error") || rows.some((r) => r.flags.some((f) => f.level === "error"));

  return {
    docs: docs.map((d) => d.kind),
    store_net,
    store_net_source,
    persons_sum,
    upt_itpos: itk?.upt ?? null,
    upt_bi: bi?.total.upt ?? null,
    single_pct_itpos: itk?.single_pct ?? null,
    single_pct_bi: bi?.total.single_pct ?? null,
    kadin_denim_units_store: kpi ? kpi.persons.reduce((s, p) => s + p.denim_units_kadin, 0) : (bi?.total.kadin_denim_units ?? null),
    denim_units_store: bi?.total.denim_units ?? (kpi ? kpi.persons.reduce((s, p) => s + p.denim_units_erkek + p.denim_units_kadin, 0) : null),
    top_seller: top?.name ?? null,
    daily: daily
      ? {
          days_expected: daily.days_expected,
          days_present: daily.days_present,
          days_missing: daily.days_missing,
          month_over: daily.month_over,
          complete: daily.complete,
          upload_days: daily.upload_days,
          archive_days: daily.archive_days,
          not_original_days: daily.not_original_days,
          store_net: daily.store_net,
        }
      : null,
    daily_agrees,
    rows,
    flags,
    ready: (!!bi || dailyComplete) && !!kpi && !hasError,
  };
}
