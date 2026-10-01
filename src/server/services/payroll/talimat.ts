import "server-only";
import ExcelJS from "exceljs";
import { GARANTI_TALIMAT, ODEME_TIPLERI } from "./bank-config";

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

/**
 * Garanti "TGB Yeni Maaş Dosyası" — bankanın şablonu bire bir:
 * B1 kurum, B2 şube, B3 hesap, B4 adet (formül), B5 toplam (formül),
 * B6 "TL ", B7 tarih metni, B8 "M", B9 "MAAS ODEMESI"; 12. satır başlık,
 * 13. satırdan itibaren kişi başı bir satır (İsim, TCKN boş, 62, Şube,
 * Hesap, IBAN, Tutar, Borç İzahat, Alacak İzahat).
 */
export async function buildGarantiTalimatXlsx(rows: TalimatRow[], isoDate: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(GARANTI_TALIMAT.sheet_name);
  const K = GARANTI_TALIMAT;

  const put = (addr: string, v: ExcelJS.CellValue) => {
    ws.getCell(addr).value = v;
  };
  put("A1", "Kurum Kodu");
  put("B1", Number(K.kurum_kodu));
  put("C1", "Garanti Bankası tarafından verilen kurum kodunuz.");
  put("A2", "Şube Kodu");
  put("B2", Number(K.sube_kodu));
  put("C2", "Şubenizden öğreniniz");
  put("A3", "Hesap");
  put("B3", Number(K.hesap));
  put("C3", "Maaş ödemesinde kullanacağınız hesap. 1299998-2 şeklinde kontrol digiti girmeyiniz.");
  put("A4", "Toplam Adet");
  put("B4", { formula: "COUNTA(A:A)-12+COUNTBLANK(A1:A12)", result: rows.length });
  put("C4", "Toplam maaş adedi. (Giriş yapıldıkça otomatik olarak hesaplanır.)");
  put("A5", "Toplam Tutar");
  put("B5", { formula: "SUM(G:G)", result: round2(rows.reduce((s, r) => s + r.amount, 0)) });
  put("C5", "Toplam ödeme tutarı. (Giriş yapıldıkça otomatik olarak hesaplanır.)");
  put("A6", "Döviz Kodu");
  put("B6", K.doviz);
  put("C6", "Döviz kodunu listeden seçiniz.");
  put("A7", "Ödeme Tarihi");
  put("B7", talimatDateText(isoDate));
  put("C7", "GGAAYYYY formatında. (Örnek: 04032001 giriniz.)");
  put("A8", "Ödeme Tipi");
  put("B8", K.odeme_tipi);
  put("C8", "Ödeme tiplerini yandaki tabloda görebilirsiniz.");
  put("A9", "Borç İzahat");
  put("B9", K.borc_izahat);
  put(
    "A10",
    "BİLGİLENDİRME : Dosyanızdaki bilgiler banka sistemine otomatik olarak yüklenecektir. Banka kodu boş veya  62 ise havale, 62'den farklı ise EFT'dir. Kayıtlar içinde EFT varsa ödeme tarihi işgünü olmalıdır. Başka bir excel dosyasından kopyalama yapmak istiyorsanız Edit/Paste Spacial seçeneğini Values seçerek kullanınız."
  );
  put("A11", "Herhangi bir hataya yol açmamak için dosyanın formatını değiştirmeyiniz, açıklamalara uyunuz. ");
  // Ödeme tipleri tablosu (I1:L9) — bankanın şablonundaki bilgi bloğu
  put("I1", "Ödeme Tipleri");
  ODEME_TIPLERI.forEach(([code, label], i) => {
    const r = 2 + Math.floor(i / 2);
    const col = i % 2 === 0 ? ["I", "J"] : ["K", "L"];
    put(`${col[0]}${r}`, code);
    put(`${col[1]}${r}`, label);
  });

  const headers = [
    "İsim",
    "TCKN (Opsiyonel)",
    "Banka Kodu",
    "Şube Kodu",
    "Hesap",
    "IBAN (Boşluksuz 26 Karakter)",
    "Tutar",
    "Borç İzahat",
    "Alacak izahat",
  ];
  headers.forEach((h, i) => put(`${String.fromCharCode(65 + i)}12`, h));
  ws.getRow(12).font = { bold: true };

  rows.forEach((r, i) => {
    const n = 13 + i;
    put(`A${n}`, r.name);
    put(`C${n}`, Number(K.banka_kodu));
    if (r.branch_code) put(`D${n}`, toNumOrText(r.branch_code));
    if (r.account_no) put(`E${n}`, toNumOrText(r.account_no));
    if (r.iban) put(`F${n}`, r.iban.replace(/\s+/g, ""));
    put(`G${n}`, round2(r.amount));
    put(`H${n}`, K.satir_izahat);
    put(`I${n}`, K.satir_izahat);
  });

  ws.getColumn(1).width = 32;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 10;
  ws.getColumn(5).width = 12;
  ws.getColumn(6).width = 30;
  ws.getColumn(7).width = 14;
  ws.getColumn(7).numFmt = "#,##0.00";
  ws.getColumn(8).width = 16;
  ws.getColumn(9).width = 16;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
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
    if (n < 13) return;
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
  const t = cellText(v).replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) && t !== "" ? n : null;
}
function toNumOrText(s: string): number | string {
  return /^\d+$/.test(s) && s.length < 16 ? Number(s) : s;
}
function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
