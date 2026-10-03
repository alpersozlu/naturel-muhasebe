import "server-only";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { PDFParse } from "pdf-parse";
import { createHash } from "node:crypto";
import { normalizeName } from "./nebim-revenue";

/**
 * Ay sonu performans belgeleri (Mavi mağazaları) — BELİRLENİMCİ okuma.
 *
 * Üç kaynak, üç ayrı SAP ekranından gelir; birbirini doğrular:
 *   bi_pdf     BI "Çalışan Performans Raporu" PDF — sayfa "ÇALIŞAN SATIŞ KPI"
 *              (kişi Net TL, UPT, tekli işlem…) + "ÇALIŞAN KATEGORİ KPI"
 *              (kategori ADET; Erkek 8 sütun, Kadın 10 sütun, Toplam)
 *   kpi_xlsx   "Personel KPI Raporu" — kişi × kategori TL ve ADET
 *              (denim = Erkek-Denim + Kadın-Denim)
 *   itpos_kpi  IT POS "Performans" KPI dışa aktarımı — mağaza Net Ciro, UPT…
 *   itpos_reps IT POS satış temsilcisi tablosu — kişi Net ciro (kuruşlu)
 *
 * Mert'in yöntemi (Ağustos 2026): kişi toplamı = SAP kişi Net ciro, denim =
 * KPI dosyası, denim dışı = fark (çocuk/sweatshirt KPI'da yok, ND'ye düşer).
 * Yapay zekâ kullanılmaz: xlsx başlıktan, PDF sekmeli metinden okunur.
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
};
export type BiPdfParsed = {
  kind: "bi_pdf";
  store_code: string | null;
  persons: BiPerson[];
  total: Omit<BiPerson, "code" | "name">;
  category_layout_ok: boolean;
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
export type KpiParsed = { kind: "kpi_xlsx"; store_code: string | null; store_label: string | null; persons: KpiPerson[] };
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

export type PerfMeta = {
  application: string | null;
  creator: string | null;
  last_modified_by: string | null;
  created: string | null;
  modified: string | null;
};

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
async function xlsxMeta(buf: Buffer): Promise<PerfMeta> {
  const meta: PerfMeta = { application: null, creator: null, last_modified_by: null, created: null, modified: null };
  try {
    const zip = await JSZip.loadAsync(buf);
    const app = await zip.file("docProps/app.xml")?.async("string");
    const core = await zip.file("docProps/core.xml")?.async("string");
    const tag = (xml: string | undefined, name: string) => xml?.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`))?.[1] ?? null;
    meta.application = tag(app, "Application");
    meta.creator = tag(core, "dc:creator");
    meta.last_modified_by = tag(core, "cp:lastModifiedBy");
    meta.created = tag(core, "dcterms:created");
    meta.modified = tag(core, "dcterms:modified");
  } catch {
    /* üstveri okunamadı — genuine=null kalır */
  }
  return meta;
}

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

async function parseBiPdf(buf: Buffer): Promise<BiPdfParsed> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  let pages: Array<{ text: string }> = [];
  try {
    const res = await parser.getText();
    pages = (res.pages ?? []).map((p: { text: string }) => ({ text: p.text }));
  } finally {
    await parser.destroy?.();
  }
  const persons = new Map<string, BiPerson>();
  const total: BiPdfParsed["total"] = { ...EMPTY_TOTAL };
  let category_layout_ok = true;
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
  const applyCategory = (t: Omit<BiPerson, "code" | "name">, cells: string[]) => {
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
      else applyCategory(target, cells);
    }
  }
  if (persons.size === 0) throw new Error("PDF'te çalışan satırı bulunamadı — bu bir BI \"Çalışan Performans Raporu\" mu?");
  const codes = Array.from(persons.keys()).map((c) => c.slice(0, 4));
  const store_code = codes.sort((a, b) => codes.filter((x) => x === b).length - codes.filter((x) => x === a).length)[0] ?? null;
  return { kind: "bi_pdf", store_code, persons: Array.from(persons.values()), total, category_layout_ok };
}

export async function parsePerformanceFile(
  fileName: string,
  buf: Buffer
): Promise<{ parsed: PerfParsed; meta: PerfMeta | null; genuine: boolean | null; hash: string; mime: string; ext: string }> {
  const isPdf = buf.subarray(0, 5).toString("latin1") === "%PDF-";
  const hash = sha256(buf);
  if (isPdf) {
    return { parsed: await parseBiPdf(buf), meta: null, genuine: null, hash, mime: "application/pdf", ext: "pdf" };
  }
  const isZip = buf.subarray(0, 2).toString("latin1") === "PK";
  if (!isZip) throw new Error(`"${fileName}" Excel (.xlsx) veya PDF değil.`);
  const [parsed, meta] = await Promise.all([parseXlsx(buf), xlsxMeta(buf)]);
  const genuine = meta.application == null ? null : meta.application === "SAP UI5" && (meta.last_modified_by ?? "SAP UI5") === "SAP UI5";
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

export type PerfPersonRow = {
  name: string;
  line_id: string | null;
  commission_profile: string | null;
  net_bi: number | null;
  net_itpos: number | null;
  /** aktarımda kullanılacak toplam: IT POS (kuruşlu) varsa o, yoksa BI */
  net_used: number | null;
  denim_tl: number | null;
  nd_tl: number | null;
  kpi_category_tl: number | null;
  denim_units_kpi: number | null;
  denim_units_bi: number | null;
  kadin_denim_units: number | null;
  upt: number | null;
  single_pct: number | null;
  flags: Array<{ level: "error" | "warn" | "info"; text: string }>;
};

export type PerfCheck = {
  docs: PerfKind[];
  store_net: number | null;
  store_net_source: "itpos" | "bi" | null;
  persons_sum: number | null;
  upt_itpos: number | null;
  upt_bi: number | null;
  single_pct_itpos: number | null;
  single_pct_bi: number | null;
  kadin_denim_units_store: number | null;
  denim_units_store: number | null;
  top_seller: string | null;
  rows: PerfPersonRow[];
  flags: Array<{ level: "error" | "warn" | "info"; text: string }>;
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
  return hits.length === 1 ? hits[0]! : null;
}

const TRY = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function buildPerformanceCheck(docs: PerfParsed[], lines: PerfLineRef[]): PerfCheck {
  const bi = docs.find((d): d is BiPdfParsed => d.kind === "bi_pdf");
  const kpi = docs.find((d): d is KpiParsed => d.kind === "kpi_xlsx");
  const itk = docs.find((d): d is ItPosKpiParsed => d.kind === "itpos_kpi");
  const itr = docs.find((d): d is ItPosRepsParsed => d.kind === "itpos_reps");
  const flags: PerfCheck["flags"] = [];

  const names = new Map<string, { name: string; bi?: BiPerson; kpi?: KpiPerson; itpos?: ItPosRepsParsed["persons"][number] }>();
  const slot = (name: string) => {
    const k = normalizeName(name);
    if (!names.has(k)) names.set(k, { name });
    return names.get(k)!;
  };
  for (const p of bi?.persons ?? []) slot(p.name).bi = p;
  for (const p of kpi?.persons ?? []) slot(p.name).kpi = p;
  for (const p of itr?.persons ?? []) slot(p.name).itpos = p;

  const rows: PerfPersonRow[] = [];
  for (const s of Array.from(names.values())) {
    const line = matchLine(s.name, lines);
    const net_bi = s.bi?.net_tl ?? null;
    const net_itpos = s.itpos?.net_ciro ?? null;
    const net_used = net_itpos ?? net_bi;
    const denim_tl = s.kpi ? r2(s.kpi.denim_tl_erkek + s.kpi.denim_tl_kadin) : null;
    const rf: PerfPersonRow["flags"] = [];
    if (net_bi != null && net_itpos != null && Math.abs(net_bi - net_itpos) > 1) {
      rf.push({
        level: Math.abs(net_bi - net_itpos) > 250 ? "error" : "warn",
        text: `Kişi cirosu iki kaynakta farklı: IT POS ${TRY.format(net_itpos)} · BI ${TRY.format(net_bi)} (fark ${TRY.format(net_itpos - net_bi)})`,
      });
    }
    const duKpi = s.kpi ? s.kpi.denim_units_erkek + s.kpi.denim_units_kadin : null;
    const duBi = s.bi?.denim_units ?? null;
    if (duKpi != null && duBi != null && duKpi !== duBi) {
      rf.push({ level: "error", text: `Denim adedi tutmuyor: KPI dosyası ${duKpi}, BI raporu ${duBi}` });
    }
    if (s.kpi && net_used != null && s.kpi.category_tl_total > net_used + 1) {
      rf.push({ level: "error", text: `KPI kategori toplamı (${TRY.format(s.kpi.category_tl_total)}) kişinin net cirosunu aşıyor` });
    } else if (s.kpi && net_used != null && net_used > 0 && (net_used - s.kpi.category_tl_total) / net_used > 0.1) {
      rf.push({
        level: "warn",
        text: `KPI kategori toplamı net cironun %${(((net_used - s.kpi.category_tl_total) / net_used) * 100).toFixed(1)} altında (çocuk/sweatshirt için beklenenden fazla)`,
      });
    }
    if (denim_tl != null && net_used != null && denim_tl > net_used + 1) rf.push({ level: "error", text: "Denim tutarı toplam cirodan büyük" });
    if (!line && (net_used ?? 0) > 1000) rf.push({ level: "warn", text: "Bordroda eşleşen personel yok — takma ad ekleyin" });
    rows.push({
      name: s.name,
      line_id: line?.line_id ?? null,
      commission_profile: line?.commission_profile ?? null,
      net_bi,
      net_itpos,
      net_used,
      denim_tl,
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
  rows.sort((a, b) => (b.net_used ?? 0) - (a.net_used ?? 0));

  const persons_sum = rows.some((r) => r.net_used != null) ? r2(rows.reduce((s, r) => s + (r.net_used ?? 0), 0)) : null;
  const store_net = itk?.net_ciro ?? bi?.total.net_tl ?? null;
  const store_net_source: PerfCheck["store_net_source"] = itk?.net_ciro != null ? "itpos" : bi?.total.net_tl != null ? "bi" : null;

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
  if (bi && !bi.category_layout_ok) flags.push({ level: "warn", text: "BI raporunun kategori sayfası beklenen düzende değil — kadın/erkek denim adedi KPI dosyasından alındı" });
  if (!bi) flags.push({ level: "warn", text: "BI Çalışan Performans Raporu (PDF) yüklenmedi" });
  if (!kpi) flags.push({ level: "warn", text: "Personel KPI Raporu (xlsx) yüklenmedi — denim ayrımı yapılamaz" });
  if (!itk) flags.push({ level: "info", text: "IT POS Performans (KPI) yüklenmedi — mağaza cirosu BI raporundan alınır" });
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
    rows,
    flags,
    ready: !!bi && !!kpi && !hasError,
  };
}
