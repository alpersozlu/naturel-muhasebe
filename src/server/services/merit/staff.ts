import "server-only";
import ExcelJS from "exceljs";
import type { PrismaClient } from "@prisma/client";
import { nameSimilarity, normalizeName } from "./cards";

/** check.ts AUTO_MATCH_MIN ile aynı eşik (döngüsel import olmasın diye burada) */
const LIST_MATCH_MIN = 0.8;

/**
 * Anlaşmalı kurum personel listeleri (sahibi, 20.10.2026): Lord's Palace ve
 * Les Ambassadeurs kart vermiyor, personel listesi veriyor. Fişteki müşteri
 * adı listedeki bir adla tutarsa indirim onaylı sayılır ("Listede"); kart aranmaz.
 */

export const STAFF_LIST_HOTELS = ["Lord's Palace", "Les Ambassadeurs", "Cratos", "Merit", "Acapulco"] as const;
export type StaffListHotel = (typeof STAFF_LIST_HOTELS)[number];

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return String(v.result ?? "");
    if (v instanceof Date) return "";
    if ("text" in v) return String(v.text ?? "");
    return "";
  }
  return String(v);
}

const HEADER_RE = /^(ad[ıi]?( soyad[ıi]?)?|soyad[ıi]?|name|surname|full ?name|personel|isim)$/i;

/**
 * Personel listesi Excel'ini (.xlsx) okur. İki düzen tanınır:
 *  - tek sütun "ADI SOYADI";
 *  - iki sütun "Adı | Soyadı" (birleştirilir). "*" / boş hücreler atlanır.
 */
export async function parseStaffXlsx(buffer: Buffer): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const names: string[] = [];
  ws.eachRow((row, i) => {
    const a = cellText(row.getCell(1).value).replace(/\s+/g, " ").trim();
    const b = cellText(row.getCell(2).value).replace(/\s+/g, " ").trim();
    if (i === 1 && (HEADER_RE.test(a) || HEADER_RE.test(b))) return;
    const parts = [a, b].filter((x) => x && x !== "*" && x !== "-");
    const n = parts.join(" ").trim();
    if (n.length >= 3) names.push(n);
  });
  return Array.from(new Set(names));
}

/** Listeyi kurum bazında DEĞİŞTİRİR (eski satırlar yumuşak silinir). */
export async function replaceStaffList(prisma: PrismaClient, hotel: string, names: string[], by: string, sourceName: string | null) {
  await prisma.hotelStaff.updateMany({ where: { hotel, deleted_at: null }, data: { deleted_at: new Date() } });
  const rows = names.map((n) => ({ hotel, full_name: n.trim(), name_key: normalizeName(n), source_name: sourceName, uploaded_by: by }));
  if (rows.length) await prisma.hotelStaff.createMany({ data: rows });
  return rows.length;
}

export type StaffIndex = Map<string, Array<{ full_name: string; name_key: string }>>;

export async function loadStaffIndex(prisma: PrismaClient): Promise<StaffIndex> {
  const rows = await prisma.hotelStaff.findMany({ where: { deleted_at: null }, select: { hotel: true, full_name: true, name_key: true } });
  const m: StaffIndex = new Map();
  for (const r of rows) (m.get(r.hotel) ?? m.set(r.hotel, []).get(r.hotel)!).push({ full_name: r.full_name, name_key: r.name_key });
  return m;
}

/** Fişteki ad kurumun listesinde var mı (ad benzerliği ≥ 0,8). */
export function matchStaff(index: StaffIndex, hotel: string, customerName: string | null): { full_name: string; score: number } | null {
  const list = index.get(hotel);
  if (!list || !customerName) return null;
  let best: { full_name: string; score: number } | null = null;
  for (const s of list) {
    const score = nameSimilarity(customerName, s.full_name);
    if (score >= LIST_MATCH_MIN && (!best || score > best.score)) best = { full_name: s.full_name, score: Math.round(score * 1000) / 1000 };
  }
  return best;
}
