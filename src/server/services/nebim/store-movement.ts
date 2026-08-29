import "server-only";
import type { PrismaClient, Prisma } from "@prisma/client";

/**
 * MAĞAZA HAREKET ÖZETİ — Nebim V3'ün aynı adlı çıktısının birebir karşılığı.
 *
 * Kullanıcı bugüne kadar bu raporu Nebim'den kâğıda basıp okuyordu; burada
 * istediği tarih/aralık için ekranda üretilir. Basılı örnekle (S02 Mağusa,
 * 07.08.2026) satır satır doğrulandı — her rakam birebir tuttu:
 *   Normal 14,00 · 44.462,36 · 24.622,46 · 18.036,28 · 1.803,62 · 19.839,90
 *   İade   −1,00 · −2.499,99 ·   −500,00 ·  −1.818,17 ·  −181,82 ·  −1.999,99
 *   Nakit 519,97 · Kredi Kartı (Optimum=KOOP BANK) 17.319,94 · Çek ±1.999,99
 *
 * ⚠️ RAPORDA OLUP BURADA OLMAYAN: "Önceki Günden Devir / Yarına Devir /
 * Nakit Kasa Bakiyeleri". Bunlar Nebim'in kasa hesap bakiyeleridir, köprü
 * satış+ödeme satırlarını taşıdığı için bizde yok. Günün nakit yekünü
 * (`payments.cash`) hesaplanabiliyor; açılış bakiyesi olmadan devir üretmek
 * uydurma olurdu, o yüzden üretilmiyor.
 */

export type HareketSatiri = {
  qty: number;
  amount_vi: number; // Tutar (VD) — KDV dahil brüt
  discount: number; // İskonto (VD) = amount_vi − net
  tax_base: number; // Vergi Matrahı
  vat: number; // Vergi
  net: number; // Net Tutar
};

export type KartSatiri = {
  card_type: string; // Nebim kart tipi ("Optimum Card")
  bank: string; // kanonik banka/ağ ("Koopbank")
  amount: number;
};

export type MagazaHareketi = {
  store_id: string | null;
  code: string | null; // S01/S02/S03
  name: string; // "Mağusa Mağaza"
  sales: { normal: HareketSatiri; returns: HareketSatiri; total: HareketSatiri };
  payments: {
    cash: number;
    cards: KartSatiri[];
    card_total: number;
    voucher_used: number; // kredi çeki ile ödenen (+)
    voucher_issued: number; // iade/değişimde düzenlenen çek (−)
    total: number; // nakit + kart + çek neti
    /**
     * Satış neti − ödeme toplamı. 0 olmalı; olmuyorsa o tutar köprünün
     * TAŞIMADIĞI bir ödeme tipiyle kapanmış demektir (ölçüldü: 01-07.08'de
     * S03'te 2 faturanın hiç ödeme satırı yok, 27.374,93 TL). Gizlemek yerine
     * raporda ayrı satır olarak gösterilir — kullanıcı neyin açıklanmadığını
     * görsün.
     */
    unexplained: number;
  };
  invoices: number; // fatura sayısı (iade hariç)
  return_invoices: number;
};

export type StoreMovementSonuc = {
  date_from: string | null;
  date_to: string | null;
  stores: MagazaHareketi[];
  /** Tüm mağazaların toplamı — "Tümü" seçiliyken üst şeritte gösterilir. */
  grand: { total: HareketSatiri; cash: number; card: number };
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (d: Prisma.Decimal | null | undefined) => (d ? Number(d) : 0);

const bosSatir = (): HareketSatiri => ({
  qty: 0,
  amount_vi: 0,
  discount: 0,
  tax_base: 0,
  vat: 0,
  net: 0,
});

function ekle(a: HareketSatiri, b: HareketSatiri): HareketSatiri {
  return {
    qty: a.qty + b.qty,
    amount_vi: a.amount_vi + b.amount_vi,
    discount: a.discount + b.discount,
    tax_base: a.tax_base + b.tax_base,
    vat: a.vat + b.vat,
    net: a.net + b.net,
  };
}

function yuvarla(s: HareketSatiri): HareketSatiri {
  return {
    qty: r2(s.qty),
    amount_vi: r2(s.amount_vi),
    discount: r2(s.discount),
    tax_base: r2(s.tax_base),
    vat: r2(s.vat),
    net: r2(s.net),
  };
}

/**
 * Nebim kart tipi → kanonik banka adı. Basılı raporda "KOOP BANK" yazan satır
 * Nebim'de "Optimum Card" olarak tutuluyor; kullanıcı bankayı tanısın diye
 * ikisi birlikte gösterilir. (day-summary.ts'teki eşlemeyle aynı mantık.)
 */
export function bankFromCardType(cardType: string): string {
  if (cardType.includes(",")) return "Karma kart";
  const t = cardType.toLocaleLowerCase("tr");
  if (t.includes("maksimum") || t.includes("maximum")) return "İş Bankası";
  if (t.includes("optimum")) return "Koopbank";
  if (t.includes("cardplus")) return "Cardplus";
  if (t.includes("garanti")) return "Garanti";
  if (t.includes("teb")) return "TEB";
  if (t.includes("ziraat")) return "Ziraat";
  return cardType;
}

export async function buildStoreMovement(
  prisma: PrismaClient,
  where: Prisma.NebimSaleLineWhereInput,
  range: { date_from?: string; date_to?: string }
): Promise<StoreMovementSonuc> {
  const lines = await prisma.nebimSaleLine.findMany({
    where,
    select: {
      store_id: true,
      nebim_store_code: true,
      store_name_raw: true,
      invoice_ref: true,
      is_return: true,
      qty: true,
      amount_vi: true,
      tax_base: true,
      vat: true,
      net_amount: true,
      pay_cash: true,
      pay_card: true,
      card_type: true,
    },
  });

  type Kova = {
    store_id: string | null;
    code: string | null;
    name: string;
    normal: HareketSatiri;
    returns: HareketSatiri;
    cash: number;
    cards: Map<string, number>;
    invoices: Set<string>;
    returnInvoices: Set<string>;
    // Ödeme tutarları FATURA bazlıdır (her satırda tekrar eder) → bir kez say
    payistSeen: Set<string>;
  };
  const kovalar = new Map<string, Kova>();
  const kova = (l: (typeof lines)[number]): Kova => {
    const k = l.store_id ?? l.nebim_store_code ?? "?";
    let o = kovalar.get(k);
    if (!o) {
      o = {
        store_id: l.store_id ?? null,
        code: l.nebim_store_code ?? null,
        name: l.store_name_raw ?? l.nebim_store_code ?? "Bilinmeyen mağaza",
        normal: bosSatir(),
        returns: bosSatir(),
        cash: 0,
        cards: new Map(),
        invoices: new Set(),
        returnInvoices: new Set(),
        payistSeen: new Set(),
      };
      kovalar.set(k, o);
    }
    return o;
  };

  for (const l of lines) {
    const o = kova(l);
    const satir: HareketSatiri = {
      qty: num(l.qty),
      amount_vi: num(l.amount_vi),
      // İskonto (VD) = brüt − net. Basılı raporla birebir tutuyor; line_disc +
      // doc_disc toplamı da aynı sonucu veriyor (ikisi de doğrulandı).
      discount: num(l.amount_vi) - num(l.net_amount),
      tax_base: num(l.tax_base),
      vat: num(l.vat),
      net: num(l.net_amount),
    };
    if (l.is_return) {
      o.returns = ekle(o.returns, satir);
      o.returnInvoices.add(l.invoice_ref);
    } else {
      o.normal = ekle(o.normal, satir);
      o.invoices.add(l.invoice_ref);
    }

    // Ödeme: iade faturalarında ödeme satırı yok; fatura başına tek sayılır
    if (!l.is_return && !o.payistSeen.has(l.invoice_ref)) {
      o.payistSeen.add(l.invoice_ref);
      o.cash += num(l.pay_cash);
      const card = num(l.pay_card);
      if (card > 0) {
        const tip = l.card_type ?? "(kart tipi yok)";
        o.cards.set(tip, (o.cards.get(tip) ?? 0) + card);
      }
    }
  }

  // Kredi çeki hareketleri (ayrı tablo) — aynı mağaza + aynı tarih aralığı
  const voucherWhere: Prisma.NebimVoucherTxnWhereInput = {};
  const storeIds = Array.from(kovalar.values())
    .map((k) => k.store_id)
    .filter(Boolean) as string[];
  if (storeIds.length > 0) voucherWhere.store_id = { in: storeIds };
  const tarih: { gte?: Date; lte?: Date } = {};
  if (range.date_from) tarih.gte = new Date(`${range.date_from}T00:00:00.000Z`);
  if (range.date_to) tarih.lte = new Date(`${range.date_to}T00:00:00.000Z`);
  if (Object.keys(tarih).length > 0) voucherWhere.txn_date = tarih;

  const vouchers =
    storeIds.length > 0
      ? await prisma.nebimVoucherTxn.findMany({
          where: voucherWhere,
          select: { store_id: true, amount: true },
        })
      : [];
  const cekKullanim = new Map<string, number>();
  const cekDuzenleme = new Map<string, number>();
  for (const v of vouchers) {
    const k = v.store_id ?? "?";
    const a = num(v.amount);
    if (a >= 0) cekKullanim.set(k, (cekKullanim.get(k) ?? 0) + a);
    else cekDuzenleme.set(k, (cekDuzenleme.get(k) ?? 0) + a);
  }

  const stores: MagazaHareketi[] = Array.from(kovalar.values())
    .map((o) => {
      const cards: KartSatiri[] = Array.from(o.cards.entries())
        .map(([card_type, amount]) => ({
          card_type,
          bank: bankFromCardType(card_type),
          amount: r2(amount),
        }))
        .sort((a, b) => b.amount - a.amount);
      const cardTotal = r2(cards.reduce((s, c) => s + c.amount, 0));
      const key = o.store_id ?? "?";
      const salesTotal = yuvarla(ekle(o.normal, o.returns));
      return {
        store_id: o.store_id,
        code: o.code,
        name: o.name,
        sales: {
          normal: yuvarla(o.normal),
          returns: yuvarla(o.returns),
          total: salesTotal,
        },
        payments: (() => {
          const used = r2(cekKullanim.get(key) ?? 0);
          const issued = r2(cekDuzenleme.get(key) ?? 0);
          const total = r2(o.cash + cardTotal + used + issued);
          return {
            cash: r2(o.cash),
            cards,
            card_total: cardTotal,
            voucher_used: used,
            voucher_issued: issued,
            total,
            unexplained: r2(salesTotal.net - total),
          };
        })(),
        invoices: o.invoices.size,
        return_invoices: o.returnInvoices.size,
      };
    })
    .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "", "tr"));

  let grandSales = bosSatir();
  let grandCash = 0;
  let grandCard = 0;
  for (const s of stores) {
    grandSales = ekle(grandSales, s.sales.total);
    grandCash += s.payments.cash;
    grandCard += s.payments.card_total;
  }

  return {
    date_from: range.date_from ?? null,
    date_to: range.date_to ?? null,
    stores,
    grand: {
      total: yuvarla(grandSales),
      cash: r2(grandCash),
      card: r2(grandCard),
    },
  };
}
