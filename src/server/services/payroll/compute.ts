/**
 * Bordro hesap motoru — saf fonksiyonlar, veritabanı yok.
 *
 * Mert'in aylık master dosyasındaki sütun mantığının bire bir karşılığı:
 *   Saatlik = Baz ÷ 208 · OT = Saatlik × saat
 *   Komisyon = profile göre (rules.ts tabloları; ÖZEL kabul edilen başarı varsa o dilim)
 *   Brüt Hak Ediş = Baz + OT + Komisyon + Parfüm + Giysi + Top-Seller + Ek Prim + Ek hak edişler − Kesintiler
 *   Toplam Ödenen = Avanslar + Ödemeler (iptal edilmemiş; talimat grubu "sent" ise)
 *   Net Kalan = Brüt Hak Ediş + Sonraki aya devredilen − Toplam Ödenen
 *     (devir: bu ay kesilemeyen tutar sonraki ayın maaşından düşer — rules.ts)
 *
 * Tutarlar NET'tir. Ara hesaplar yuvarlanmaz, çıktılar 2 haneye yuvarlanır
 * (Excel'deki görünümle aynı).
 */
import {
  ADVANCE_WARN_SHARE,
  CARRY_FORWARD_CATEGORY,
  DERI_ASISTAN_TABLE,
  DERI_MUDUR_TABLE,
  GARMENT_PREMIUM_PER_UNIT,
  MAVI_ASISTAN_TABLE,
  MAVI_MUDUR_TABLE,
  MAVI_VICE_FACTOR,
  NEAR_ZERO_TL,
  OVERTIME_DIVISOR,
  PERFUME_PREMIUM_PER_UNIT,
  TOP_SELLER_PREMIUM,
  bracketFor,
  type CommissionProfile,
} from "./rules";

export type EntryKind = "advance" | "payment" | "deduction" | "addition";
export type BatchStatus = "prepared" | "sent" | "void";

export type EntryLike = {
  id: string;
  kind: EntryKind;
  category: string | null;
  channel: string | null;
  entry_date: Date | string;
  amount: number;
  note: string | null;
  reference: string | null;
  voided_at: Date | string | null;
  batch: { id: string; status: BatchStatus; title: string } | null;
  /** "Sonraki aya devret" çiftinin ortak kimliği (rules.ts CARRY_FORWARD_CATEGORY) */
  carry_id?: string | null;
};

export type LineInput = {
  base_salary: number;
  commission_profile: CommissionProfile;
  overtime_hours: number;
  own_revenue_nd: number | null;
  own_revenue_denim: number | null;
  own_revenue: number | null;
  own_target: number | null;
  achievement_accepted: number | null;
  commission_override: number | null;
  commission_note: string | null;
  perfume_units: number;
  garment_units: number;
  top_seller: boolean;
  extra_premium: number;
  extra_premium_note: string | null;
  /** Çalışan kalıcı bayrakları */
  paid_month_early: boolean;
  status: "active" | "inactive" | "left";
};

export type StoreMonthInput = {
  revenue: number | null;
  target: number | null;
};

export type Flag = {
  code:
    | "early_paid"
    | "inactive"
    | "left"
    | "advance_high"
    | "near_zero"
    | "overpaid"
    | "carry_excess"
    | "missing_target"
    | "no_revenue"
    | "special"
    | "override"
    | "denim_split_missing"
    | "note_missing";
  level: "info" | "warn" | "error";
  text: string;
};

export type CommissionCalc = {
  profile: CommissionProfile;
  /** Hesaba esas ciro (asistan: kendi; müdür/yrd: mağaza) */
  basis: number;
  basis_label: string;
  target: number | null;
  /** Fiili başarı oranı (1 = %100) */
  achievement: number | null;
  /** Dilim için kullanılan oran — ÖZEL kabul varsa o */
  achievement_used: number | null;
  special: boolean;
  rate: number | null; // tek oranlı profiller
  rate_nd: number | null; // Mavi asistan
  rate_denim: number | null;
  computed: number;
  final: number;
  overridden: boolean;
  explanation: string[];
};

export type AnnotatedEntry = EntryLike & { counted: boolean; counted_note: string | null };

export type LineCalc = {
  hourly_rate: number;
  overtime_amount: number;
  commission: CommissionCalc;
  perfume_amount: number;
  garment_amount: number;
  top_seller_amount: number;
  extra_premium: number;
  additions_total: number;
  deductions_total: number;
  /** Bu ay kesilemeyip sonraki ayın maaşına devredilen tutar (hak ediş değildir) */
  carried_forward_total: number;
  gross: number;
  advances_total: number;
  payments_total: number;
  paid_total: number;
  net_remaining: number;
  /** Ödeme 1 için şu an ödenecek: baz + ek − kesinti − ödenmiş (0'ın altına inmez) */
  payment1_due: number;
  /** Ödeme 1 sonrası kalan: OT + komisyon + primler */
  payment2_due: number;
  /** Baz maaş tamamen ödendi mi (sahibinin akışı: Garanti + Ziraat + nakit → "maaşlar kapandı") */
  base_paid: boolean;
  /**
   * Kesintinin bölünmesi: kesinti önce baz maaştan (Ödeme 1) düşer; maaş yetmezse
   * kalanı Ödeme 2'den (mesai/komisyon/prim) düşer. Ödeme 2 ekranlarında yalnız
   * deductions_from_extras gösterilir (07.10.2026: Yaşar Kemal'in 38.409,70'i
   * maaşından kesilmişken Ödeme 2 tablosunda kesinti gibi görünüyordu).
   */
  deductions_from_salary: number;
  deductions_from_extras: number;
  /** Bu ay Ödeme 2 olarak fiilen ödenen (payment / payment2 kayıtları, sayılanlar) */
  payment2_paid: number;
  /** Kişi Ödeme 2 kapsamında mı: bir Ödeme 2 ödemesi var ya da ödenecek Ödeme 2'si var */
  payment2_in_scope: boolean;
  /** Ödeme 2 kapandı mı: ödeme yapıldı ve kalan yok */
  payment2_settled: boolean;
  /** Ödeme 2 kapsamı: mesai + komisyon + primler + ek hak edişler */
  extras_total: number;
  entries: AnnotatedEntry[];
  flags: Flag[];
};

const TRY = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const RATE = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export const fmtTRY = (v: number) => `${TRY.format(v)} ₺`;
export const fmtPct = (ratio: number) => `%${PCT.format(ratio * 100)}`;
export const fmtRate = (rate: number) => `%${RATE.format(rate * 100)}`;

export function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Kayıt toplama girer mi? İptal edilmişse hayır; talimat grubu varsa yalnız "sent". */
export function entryCounts(e: EntryLike): { counted: boolean; note: string | null } {
  if (e.voided_at) return { counted: false, note: "İptal edildi" };
  if ((e.kind === "advance" || e.kind === "payment") && e.batch) {
    if (e.batch.status === "void") return { counted: false, note: "Talimat iptal" };
    if (e.batch.status === "prepared")
      return { counted: false, note: "Talimat hazırlandı, gönderilmedi" };
  }
  return { counted: true, note: null };
}

/**
 * Aynı tür ödeme için HAZIRLANMIŞ ama gönderilmemiş talimat kayıtları. Bunlar
 * toplama girmez (entryCounts), bu yüzden kişi yeni bir listede yeniden çıkar.
 * İkinci kez ödenmesin diye listede uyarı olarak gösterilir ve kişi seçili
 * gelmez (ör. Ödeme 2 için hazırlanıp gönderilmemiş bir Garanti talimatı
 * dururken aynı kişi nakit listesine de girer).
 */
export function pendingPrepared(
  entries: EntryLike[],
  kind: "advance" | "payment1" | "payment2" | "single"
): { amount: number; channels: string[] } {
  const hit = entries.filter(
    (e) =>
      !e.voided_at &&
      e.batch?.status === "prepared" &&
      (kind === "advance" ? e.kind === "advance" : e.kind === "payment" && e.category === kind)
  );
  return {
    amount: round2(hit.reduce((s, e) => s + e.amount, 0)),
    channels: Array.from(new Set(hit.map((e) => e.channel ?? "other"))),
  };
}

export function computeCommission(line: LineInput, store: StoreMonthInput): CommissionCalc {
  const p = line.commission_profile;
  const ex: string[] = [];
  const base: CommissionCalc = {
    profile: p,
    basis: 0,
    basis_label: "",
    target: null,
    achievement: null,
    achievement_used: null,
    special: false,
    rate: null,
    rate_nd: null,
    rate_denim: null,
    computed: 0,
    final: 0,
    overridden: false,
    explanation: ex,
  };
  if (p === "none") {
    ex.push("Komisyon yok.");
    return finish(base, line);
  }

  const isStore = p === "mavi_mudur" || p === "mavi_vice" || p === "deri_mudur";
  const nd = line.own_revenue_nd ?? 0;
  const denim = line.own_revenue_denim ?? 0;
  const ownSplit = line.own_revenue_nd != null || line.own_revenue_denim != null;
  const own = ownSplit ? nd + denim : (line.own_revenue ?? 0);

  base.basis = isStore ? (store.revenue ?? 0) : own;
  base.basis_label = isStore ? "Mağaza cirosu" : "Kendi cirosu";
  base.target = isStore ? store.target : line.own_target;

  if (base.basis <= 0) {
    ex.push(isStore ? "Mağaza cirosu girilmedi." : "Kişisel ciro girilmedi.");
    return finish(base, line);
  }
  if (base.target && base.target > 0) base.achievement = base.basis / base.target;

  const accepted = line.achievement_accepted;
  base.special = accepted != null && (base.achievement == null || Math.abs(accepted - base.achievement) > 1e-6);
  base.achievement_used = accepted ?? base.achievement;

  if (base.achievement_used == null) {
    ex.push(`${base.basis_label} ${fmtTRY(base.basis)} — hedef girilmedi, dilim seçilemedi.`);
    return finish(base, line);
  }

  const achText =
    base.achievement != null && base.target
      ? `${base.basis_label} ${fmtTRY(base.basis)} ÷ hedef ${fmtTRY(base.target)} = ${fmtPct(base.achievement)}`
      : `${base.basis_label} ${fmtTRY(base.basis)}`;
  ex.push(achText);
  if (base.special && accepted != null) {
    ex.push(`ÖZEL: yönetim kararıyla ${fmtPct(accepted)} başarı kabul edildi.`);
  }

  const a = base.achievement_used;
  if (p === "mavi_asistan") {
    const b = bracketFor(MAVI_ASISTAN_TABLE, a);
    base.rate_nd = b.nd;
    base.rate_denim = b.denim;
    if (!ownSplit && own > 0) {
      // Denim ayrımı yoksa tamamı denim dışı sayılır (düşük oran) — uyarı düşer.
      base.computed = own * b.nd;
      ex.push(`Denim ayrımı girilmedi → tamamı ND: ${fmtTRY(own)} × ${fmtRate(b.nd)} = ${fmtTRY(base.computed)}`);
    } else {
      base.computed = nd * b.nd + denim * b.denim;
      ex.push(
        `Dilim → ND ${fmtRate(b.nd)} / denim ${fmtRate(b.denim)} · ND ${fmtTRY(nd)} × ${fmtRate(b.nd)} = ${fmtTRY(nd * b.nd)} + denim ${fmtTRY(denim)} × ${fmtRate(b.denim)} = ${fmtTRY(denim * b.denim)}`
      );
    }
  } else if (p === "mavi_mudur" || p === "mavi_vice") {
    const b = bracketFor(MAVI_MUDUR_TABLE, a);
    const rate = p === "mavi_vice" ? b.rate * MAVI_VICE_FACTOR : b.rate;
    base.rate = rate;
    base.computed = base.basis * rate;
    ex.push(
      p === "mavi_vice"
        ? `Müdür oranı ${fmtRate(b.rate)} × 0,75 = ${fmtRate(rate)} · ${fmtTRY(base.basis)} × ${fmtRate(rate)} = ${fmtTRY(base.computed)}`
        : `Müdür oranı ${fmtRate(rate)} · ${fmtTRY(base.basis)} × ${fmtRate(rate)} = ${fmtTRY(base.computed)}`
    );
  } else if (p === "deri_asistan") {
    const b = bracketFor(DERI_ASISTAN_TABLE, a);
    base.rate = b.rate;
    base.computed = base.basis * b.rate;
    ex.push(`Oran ${fmtRate(b.rate)} · ${fmtTRY(base.basis)} × ${fmtRate(b.rate)} = ${fmtTRY(base.computed)}`);
  } else if (p === "deri_mudur") {
    const b = bracketFor(DERI_MUDUR_TABLE, a);
    base.rate = b.rate;
    base.computed = base.basis * b.rate;
    ex.push(`Müdür oranı ${fmtRate(b.rate)} · ${fmtTRY(base.basis)} × ${fmtRate(b.rate)} = ${fmtTRY(base.computed)}`);
  }
  return finish(base, line);
}

function finish(c: CommissionCalc, line: LineInput): CommissionCalc {
  if (line.commission_override != null) {
    c.overridden = true;
    c.final = line.commission_override;
    c.explanation.push(
      `Elle girilen komisyon: ${fmtTRY(line.commission_override)}${line.commission_note ? ` — ${line.commission_note}` : ""}`
    );
  } else {
    c.final = c.computed;
  }
  c.computed = round2(c.computed);
  c.final = round2(c.final);
  return c;
}

export function computeLine(line: LineInput, store: StoreMonthInput, entries: EntryLike[]): LineCalc {
  const hourly = line.base_salary / OVERTIME_DIVISOR;
  const overtime = hourly * (line.overtime_hours || 0);
  const commission = computeCommission(line, store);
  const perfume = (line.perfume_units || 0) * PERFUME_PREMIUM_PER_UNIT;
  const garment = (line.garment_units || 0) * GARMENT_PREMIUM_PER_UNIT;
  const topSeller = line.top_seller ? TOP_SELLER_PREMIUM : 0;
  const extra = line.extra_premium || 0;

  const annotated: AnnotatedEntry[] = entries.map((e) => {
    const { counted, note } = entryCounts(e);
    return { ...e, counted, counted_note: note };
  });
  const sum = (kind: EntryKind) =>
    annotated.filter((e) => e.kind === kind && e.counted).reduce((s, e) => s + e.amount, 0);
  // Sonraki aya devredilen tutar "addition" olarak saklanır ama hak ediş
  // değildir: brüte ve primlere girmez, yalnız bu ayın bakiyesini kapatır.
  const carried = annotated
    .filter((e) => e.kind === "addition" && e.category === CARRY_FORWARD_CATEGORY && e.counted)
    .reduce((s, e) => s + e.amount, 0);
  const additions = sum("addition") - carried;
  const deductions = sum("deduction");
  const advances = sum("advance");
  const payments = sum("payment");
  const payment2Paid = annotated
    .filter((e) => e.kind === "payment" && e.category === "payment2" && e.counted)
    .reduce((s, e) => s + e.amount, 0);

  const gross =
    line.base_salary + overtime + commission.final + perfume + garment + topSeller + extra + additions - deductions;
  const paid = advances + payments;
  const net = gross + carried - paid;

  const p1raw = line.base_salary + additions - deductions - paid;
  const payment1 = Math.max(0, Math.min(p1raw, net));
  const payment2 = Math.max(0, net - payment1);
  // p1raw < 0 ise maaş kesintiyi karşılayamadı: eksik kadarı Ödeme 2'den düşer
  // (fazla ödeme halinde eksik kesintiden büyük olabilir — kesintiyle sınırlanır).
  const dedFromExtras = Math.min(deductions, Math.max(0, -p1raw));
  const extras = overtime + commission.final + perfume + garment + topSeller + extra + additions;

  const flags: Flag[] = [];
  if (line.status === "left") flags.push({ code: "left", level: "info", text: "Ayrıldı — son bordro / çıkış mutabakatı." });
  if (line.status === "inactive")
    flags.push({ code: "inactive", level: "info", text: "Bu ay çalışmıyor — ödeme beklenmiyor." });
  if (line.paid_month_early)
    flags.push({
      code: "early_paid",
      level: "info",
      text: "Maaşı bir ay önceden ödenir — bu ayın talimatına girmez, erken ödeme kayıt olarak işlenir.",
    });
  if (line.base_salary > 0 && advances > line.base_salary * ADVANCE_WARN_SHARE)
    flags.push({
      code: "advance_high",
      level: "warn",
      text: `Avans netin ${fmtPct(advances / line.base_salary)}'i — %50 sınırının üstünde.`,
    });
  if (line.base_salary > 0 && (deductions > 0 || advances > 0)) {
    // Ek hak edişler (izin ödemesi gibi) de eline geçecek tutara dahildir.
    const left = line.base_salary + additions - deductions - advances;
    if (left < NEAR_ZERO_TL)
      flags.push({
        code: "near_zero",
        level: left < 0 ? "error" : "warn",
        text: `Kesinti + avans sonrası bazdan kalan ${fmtTRY(left)} — eline neredeyse hiçbir şey geçmeyecek.`,
      });
  }
  if (net < -0.5)
    flags.push({
      code: "overpaid",
      level: "error",
      text: `Fazla ödeme: ${fmtTRY(-net)} — hak edişten fazla ödendi. Sonraki ayın maaşından düşmek için "Sonraki aya devret".`,
    });
  if (carried > 0.005 && net > 0.5)
    flags.push({
      code: "carry_excess",
      level: "warn",
      text: `Sonraki aya ${fmtTRY(carried)} devredildi ama bu ay artık ${fmtTRY(net)} alacaklı — devri iptal edip yeniden devredin ya da farkı Ödeme 2 ile ödeyin.`,
    });
  if (line.commission_profile !== "none") {
    if (commission.basis > 0 && !commission.target)
      flags.push({ code: "missing_target", level: "warn", text: "Ciro var ama hedef girilmedi — komisyon hesaplanamıyor." });
    if (commission.basis <= 0 && line.status === "active")
      flags.push({ code: "no_revenue", level: "info", text: "Ciro bekleniyor (Ödeme 2 için)." });
    if (
      line.commission_profile === "mavi_asistan" &&
      line.own_revenue_nd == null &&
      line.own_revenue_denim == null &&
      (line.own_revenue ?? 0) > 0
    )
      flags.push({ code: "denim_split_missing", level: "warn", text: "Denim / denim dışı ayrımı girilmedi — tamamı düşük orandan hesaplandı." });
  }
  if (commission.special) {
    flags.push({ code: "special", level: "info", text: "ÖZEL — başarı yönetim kararıyla üst dilime kabul edildi." });
    if (!line.commission_note) flags.push({ code: "note_missing", level: "warn", text: "ÖZEL karar için not yok (kim, ne zaman)." });
  }
  if (commission.overridden) {
    flags.push({ code: "override", level: "info", text: "Komisyon elle girildi." });
    if (!line.commission_note) flags.push({ code: "note_missing", level: "warn", text: "Elle girilen komisyon için not yok." });
  }
  if (extra > 0 && !line.extra_premium_note)
    flags.push({ code: "note_missing", level: "warn", text: "Ek prim için açıklama notu yok." });

  return {
    hourly_rate: round2(hourly),
    overtime_amount: round2(overtime),
    commission,
    perfume_amount: round2(perfume),
    garment_amount: round2(garment),
    top_seller_amount: topSeller,
    extra_premium: round2(extra),
    additions_total: round2(additions),
    deductions_total: round2(deductions),
    carried_forward_total: round2(carried),
    gross: round2(gross),
    advances_total: round2(advances),
    payments_total: round2(payments),
    paid_total: round2(paid),
    net_remaining: round2(net),
    payment1_due: round2(payment1),
    payment2_due: round2(payment2),
    base_paid: payment1 <= 0.5,
    deductions_from_salary: round2(deductions - dedFromExtras),
    deductions_from_extras: round2(dedFromExtras),
    payment2_paid: round2(payment2Paid),
    payment2_in_scope: payment2Paid > 0.005 || payment2 > 0.5,
    payment2_settled: payment2Paid > 0.005 && payment2 <= 0.5,
    extras_total: round2(extras),
    entries: annotated,
    flags,
  };
}
