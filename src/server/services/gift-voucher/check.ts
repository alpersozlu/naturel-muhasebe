import "server-only";
import type { PrismaClient } from "@prisma/client";
import { checkVoucher, parseVoucherBarcode, type VoucherCheckResult } from "@/lib/gift-voucher-rules";

const num = (d: { toNumber(): number } | null | undefined) => d?.toNumber() ?? 0;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Okutulan fiş numarasını temizle: boşluk, görünmez karakter. */
export function cleanReceiptRef(raw: string): string {
  return (raw ?? "").replace(/\s+/g, "").replace(/[^0-9A-Za-z-]/g, "");
}

/**
 * Mavi fişini bul. Barkod okutulduğunda numara birebir gelir; elle yazıldıysa
 * ya da fotoğraftan okunduysa bir hane kayabilir — tam eşleşme yoksa TEK hane
 * farkı olan adaya bakılır (iki aday varsa karar kullanıcıya kalır).
 */
export async function findMaviReceipt(prisma: PrismaClient, ref: string) {
  const clean = cleanReceiptRef(ref);
  if (!clean) return { receipt: null, ambiguous: false as const };
  const exact = await prisma.maviReceipt.findFirst({
    where: { ref: clean },
    include: { store: { select: { name: true } } },
  });
  if (exact) return { receipt: exact, ambiguous: false as const };
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
 * Fiş, elimizdeki verinin BAŞLADIĞI tarihten eski mi?
 *
 * Fiş numaraları mağaza içinde sıralıdır (9400000012935988 < 9400000013268414),
 * yani okutulan numara o mağazadaki EN KÜÇÜK kayıttan da küçükse o alışveriş
 * biz veri toplamaya başlamadan önce yapılmıştır. Böyle bir fişi "sahte"
 * saymak yanlış olur: eski (barkodsuz) çeklerin fişleri buraya düşer, karar
 * yöneticiye kalır. Veri eylül 2026'da başlıyor; 27.07 öncesi süresiz çeklerin
 * fişleri sistemde HİÇ yok.
 */
export async function isBeforeCoverage(prisma: PrismaClient, ref: string): Promise<{ older: boolean; coverage_from: string | null }> {
  const clean = cleanReceiptRef(ref);
  if (!/^\d{12,}$/.test(clean)) return { older: false, coverage_from: null };
  const prefix = clean.slice(0, 4); // mağaza kodu: 9400 / 9401 / 9402 / 9403
  const oldest = await prisma.maviReceipt.findFirst({
    where: { ref: { startsWith: prefix } },
    orderBy: { ref: "asc" },
    select: { ref: true, date: true },
  });
  if (!oldest || oldest.ref.length !== clean.length) return { older: false, coverage_from: null };
  return { older: clean < oldest.ref, coverage_from: oldest.date.toISOString().slice(0, 10) };
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

  const reasons = [...check.reasons];
  // "Sahte fiş" demeden önce: bu numara veri kapsamımızdan eski olabilir.
  if (!receipt) {
    const cov = await isBeforeCoverage(prisma, input.receipt_ref);
    if (cov.older) {
      const tr = (cov.coverage_from ?? "").split("-").reverse().join(".");
      reasons.length = 0;
      reasons.push(
        `Bu fiş, sistemdeki Mavi verisinden daha eski (veri ${tr} tarihinde başlıyor) — numara doğru olabilir ama tutarını buradan doğrulayamıyoruz. Yönetici elle onaylayabilir.`
      );
    }
  }
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
