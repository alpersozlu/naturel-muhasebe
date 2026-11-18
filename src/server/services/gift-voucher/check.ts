import "server-only";
import type { PrismaClient } from "@prisma/client";
import { checkVoucher, parseVoucherBarcode, type VoucherCheckResult } from "@/lib/gift-voucher-rules";

const num = (d: { toNumber(): number } | null | undefined) => d?.toNumber() ?? 0;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Mavi Fatura No: mağaza kodu (94xx) + 0000 + 8 hane = 16 hane. */
const FATURA_NO = /^94\d{2}0000\d{8}$/;

/**
 * Okutulan fiş numarasını temizle: boşluk, görünmez karakter.
 *
 * Kutuda eski yazı kalmışken okutulan numara ARKAYA eklenir — 18.11.2026 Mavi
 * Mağusa: kutuda "940200001" duruyordu, barkod okutulunca
 * "9402000019402000011781980" oldu, gerçek fiş "bulunamadı" ve "sahte" denildi.
 * Barkod okuyucu numarayı her zaman sona yazdığı için 16 haneden uzun bir
 * girdinin SON 16 hanesi geçerli bir Fatura No ise o alınır.
 */
export function cleanReceiptRef(raw: string): string {
  const s = (raw ?? "").replace(/\s+/g, "").replace(/[^0-9A-Za-z-]/g, "");
  if (/^\d{17,}$/.test(s)) {
    const tail = s.slice(-16);
    if (FATURA_NO.test(tail)) return tail;
  }
  return s;
}

/**
 * Mavi fişini bul. Barkod okutulduğunda numara birebir gelir; elle yazıldıysa
 * ya da fotoğraftan okunduysa bir hane kayabilir — tam eşleşme yoksa TEK hane
 * farkı olan adaya bakılır (iki aday varsa karar kullanıcıya kalır).
 */
/**
 * Uzun bir barkodun İÇİNDEKİ Fatura No adayları (16 hane, 94xx0000 + 8 hane),
 * soldan sağa, tekrarsız.
 *
 * 18.11.2026 Mavi Mağusa: müşteri adına kesilen (e-Arşiv) bilgi fişinin
 * barkodu 32 hanedir ve Fatura No ortasındadır —
 *   "940200001" + "9402000011781980" + "2663645".
 * Lefkoşa'nın düz fişlerinde barkod yalnız Fatura No'dur. Hangi pencerenin
 * gerçek numara olduğuna veritabanı karar verir (yalnız biri kayıtlıdır).
 */
export function faturaNoCandidates(raw: string): string[] {
  const s = (raw ?? "").replace(/\D/g, "");
  if (s.length <= 16) return [];
  const out: string[] = [];
  for (let i = 0; i + 16 <= s.length; i++) {
    const w = s.slice(i, i + 16);
    if (FATURA_NO.test(w) && !out.includes(w)) out.push(w);
  }
  return out;
}

export async function findMaviReceipt(prisma: PrismaClient, ref: string) {
  const clean = cleanReceiptRef(ref);
  if (!clean) return { receipt: null, ambiguous: false as const };
  const exact = await prisma.maviReceipt.findFirst({
    where: { ref: clean },
    include: { store: { select: { name: true } } },
  });
  if (exact) return { receipt: exact, ambiguous: false as const };
  // Barkod Fatura No'dan uzunsa (e-Arşiv fişi, ya da kutuda kalan eski
  // rakamlar): içindeki Fatura No adaylarından KAYITLI olanı al.
  const candidates = faturaNoCandidates(ref);
  if (candidates.length > 0) {
    const found = await prisma.maviReceipt.findMany({
      where: { ref: { in: candidates } },
      include: { store: { select: { name: true } } },
    });
    const refs = Array.from(new Set(found.map((f) => f.ref)));
    if (refs.length === 1) return { receipt: found.find((f) => f.ref === refs[0])!, ambiguous: false as const };
    if (refs.length > 1) return { receipt: null, ambiguous: true as const };
  }
  if (!/^\d{10,}$/.test(clean)) return { receipt: null, ambiguous: false as const };
  const near = await prisma.maviReceipt.findMany({
    where: { ref: { startsWith: clean.slice(0, 6) } },
    include: { store: { select: { name: true } } },
    take: 5000,
  });
  const hits = near.filter((r) => {
    if (r.ref.length !== clean.length) return false;
    let diff = 0;
    for (let i = 0; i < clean.length; i++) if (r.ref[i] !== clean[i] && ++diff > 1) return false;
    return diff === 1;
  });
  if (hits.length === 1) return { receipt: hits[0]!, ambiguous: false as const };
  return { receipt: null, ambiguous: hits.length > 1 };
}

/**
 * Mavi'nin o güne ait verisi sistemde var mı? "Fiş yok" ile "dosya henüz
 * gelmedi" ayrımı buna dayanır.
 */
export async function maviSourceLoaded(prisma: PrismaClient, aroundIso: string | null): Promise<boolean> {
  if (!aroundIso) {
    const recent = await prisma.maviReceipt.count({
      where: { created_at: { gte: new Date(Date.now() - 3 * 86400000) } },
    });
    return recent > 0;
  }
  const from = new Date(`${aroundIso}T00:00:00.000Z`);
  const to = new Date(from.getTime() + 2 * 86400000);
  return (await prisma.maviReceipt.count({ where: { date: { gte: from, lte: to } } })) > 0;
}

export type ClaimInput = {
  /** Okutulan barkod; barkodsuz eski çekte boş. */
  voucher_barcode?: string | null;
  /** Barkodsuz eski çekte elle girilen küpür. */
  manual_amount?: number | null;
  receipt_ref: string;
  used_date?: string | null;
  used_store_id?: string | null;
  customer_name?: string | null;
};

export type ClaimPreview = {
  voucher: { barcode: string | null; amount: number; manual: boolean } | null;
  barcode_error: string | null;
  receipt:
    | { id: string; ref: string; store_name: string; date: string; net_amount: number; is_refund: boolean }
    | null;
  ambiguous: boolean;
  other_vouchers_total: number;
  check: VoucherCheckResult;
};

/** Kaydetmeden önce kararı hesapla (ekranda anında göstermek için). */
export async function previewClaim(prisma: PrismaClient, input: ClaimInput): Promise<ClaimPreview> {
  // Barkodsuz ESKİ çek: tutar elle girilir, barkod kontrolü yapılmaz.
  const raw = (input.voucher_barcode ?? "").trim();
  const manualAmount = input.manual_amount ?? null;
  const useManual = !raw && !!manualAmount;
  const parsed = useManual
    ? ({ ok: true as const, barcode: "", amount: manualAmount!, sequence: "" })
    : parseVoucherBarcode(raw);

  const { receipt, ambiguous } = await findMaviReceipt(prisma, input.receipt_ref);

  const others = receipt
    ? await prisma.giftVoucherClaim.findMany({
        where: {
          mavi_receipt_id: receipt.id,
          ...(parsed.ok && parsed.barcode ? { NOT: { barcode: parsed.barcode } } : {}),
        },
        select: { amount: true },
      })
    : [];
  const otherTotal = others.reduce((s, o) => s + num(o.amount), 0);

  const check = checkVoucher({
    receipt_amount: receipt ? num(receipt.net_amount) : null,
    receipt_date: receipt ? iso(receipt.date) : null,
    receipt_refund: receipt?.is_refund ?? false,
    other_vouchers_total: otherTotal,
    voucher_amount: parsed.ok ? parsed.amount : 0,
    used_date: input.used_date ?? null,
    source_loaded: await maviSourceLoaded(prisma, receipt ? iso(receipt.date) : null),
  });

  // "Verimizden eski" tahmini KALDIRILDI (18.11.2026): fiş numaraları tarih
  // sırasıyla artmıyor — Mağusa'nın yalnız 24.10'daki 92 fişi 8,7 milyondan
  // 13,2 milyona dağılıyor — yani numaraya bakıp fişin eski olduğu söylenemez.
  const reasons = [...check.reasons];
  if (!parsed.ok) reasons.unshift(parsed.reason);
  if (ambiguous) reasons.unshift("Fiş numarası birden çok kayda yakın — numarayı yeniden okutun.");
  const status: VoucherCheckResult["status"] = !parsed.ok || ambiguous ? "fail" : check.status;

  return {
    voucher: parsed.ok ? { barcode: useManual ? null : parsed.barcode, amount: parsed.amount, manual: useManual } : null,
    barcode_error: parsed.ok ? null : parsed.reason,
    receipt: receipt
      ? {
          id: receipt.id,
          ref: receipt.ref,
          store_name: receipt.store.name,
          date: iso(receipt.date),
          net_amount: num(receipt.net_amount),
          is_refund: receipt.is_refund,
        }
      : null,
    ambiguous,
    other_vouchers_total: otherTotal,
    check: { ...check, status, reasons },
  };
}

/** Bekleyen kayıtları yeniden değerlendir (Mavi dosyası sonradan gelince). */
export async function recheckPending(prisma: PrismaClient): Promise<{ checked: number; resolved: number }> {
  const pending = await prisma.giftVoucherClaim.findMany({
    where: { status: "pending" },
    select: { id: true, barcode: true, amount: true, receipt_ref: true, used_date: true, is_manual: true },
  });
  let resolved = 0;
  for (const c of pending) {
    const p = await previewClaim(prisma, {
      voucher_barcode: c.is_manual ? null : c.barcode,
      manual_amount: c.is_manual ? num(c.amount) : null,
      receipt_ref: c.receipt_ref,
      used_date: c.used_date ? iso(c.used_date) : null,
    });
    if (p.check.status === "pending") continue;
    await prisma.giftVoucherClaim.update({
      where: { id: c.id },
      data: { status: p.check.status, reasons: p.check.reasons, mavi_receipt_id: p.receipt?.id ?? null },
    });
    resolved++;
  }
  return { checked: pending.length, resolved };
}
