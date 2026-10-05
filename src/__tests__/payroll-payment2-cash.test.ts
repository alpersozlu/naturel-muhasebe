import { describe, expect, it } from "vitest";
import { computeLine, pendingPrepared, type EntryLike, type LineInput } from "@/server/services/payroll/compute";
import { PAYMENT2_CHANNEL, batchChannelError, inBatchList } from "@/server/services/payroll/rules";

/**
 * Ödeme 2 (mesai + komisyon + prim) herkese NAKİT ödenir (sahibi, 05.10.2026).
 * Banka talimatı hazırlanmaz; nakit listesine maaşını bankadan alanlar da girer.
 */
const PAY_METHODS = ["garanti", "ziraat", "cash"] as const;

describe("Ödeme 2 nakit ödenir", () => {
  it("Ödeme 2 için Garanti ve Ziraat reddedilir, nakit kabul edilir", () => {
    expect(PAYMENT2_CHANNEL).toBe("cash");
    expect(batchChannelError("payment2", "garanti")).toMatch(/nakit/);
    expect(batchChannelError("payment2", "ziraat")).toMatch(/nakit/);
    expect(batchChannelError("payment2", "cash")).toBeNull();
  });

  it("avans, Ödeme 1 ve tekil ödemede kanal kısıtı yok", () => {
    for (const kind of ["advance", "payment1", "single"]) for (const ch of PAY_METHODS) expect(batchChannelError(kind, ch)).toBeNull();
  });

  it("Ödeme 2 nakit listesine maaş kanalına bakılmadan herkes girer", () => {
    for (const pm of PAY_METHODS) expect(inBatchList("payment2", "cash", pm)).toBe(true);
    // banka kanalıyla çağrılsa bile kimse listelenmez
    for (const pm of PAY_METHODS) for (const ch of ["garanti", "ziraat"]) expect(inBatchList("payment2", ch, pm)).toBe(false);
  });

  it("avans ve Ödeme 1'de kişi yalnız kendi maaş kanalının listesindedir", () => {
    for (const kind of ["advance", "payment1", "single"])
      for (const ch of PAY_METHODS) for (const pm of PAY_METHODS) expect(inBatchList(kind, ch, pm)).toBe(ch === pm);
  });
});

const entry = (over: Partial<EntryLike>): EntryLike => ({
  id: Math.random().toString(36).slice(2),
  kind: "payment",
  category: "payment2",
  channel: "garanti",
  entry_date: "2026-10-05",
  amount: 10_000,
  note: null,
  reference: null,
  voided_at: null,
  batch: { id: "b1", status: "prepared", title: "Ödeme 2 · Garanti" },
  ...over,
});

describe("hazırlanmış, gönderilmemiş talimat — çift ödeme uyarısı", () => {
  it("aynı tür için hazırlanmış talimat tutarı ve kanalı bulunur", () => {
    expect(pendingPrepared([entry({})], "payment2")).toEqual({ amount: 10_000, channels: ["garanti"] });
  });

  it("gönderilmiş, iptal edilmiş ya da başka türdeki kayıt sayılmaz", () => {
    const es = [
      entry({ batch: { id: "b2", status: "sent", title: "" } }),
      entry({ batch: { id: "b3", status: "void", title: "" } }),
      entry({ voided_at: "2026-10-05" }),
      entry({ batch: null, channel: "cash" }), // elle girilmiş ödeme: zaten sayılır
      entry({ category: "payment1" }),
      entry({ kind: "advance", category: null }),
    ];
    expect(pendingPrepared(es, "payment2")).toEqual({ amount: 0, channels: [] });
    expect(pendingPrepared(es, "payment1")).toEqual({ amount: 10_000, channels: ["garanti"] });
    expect(pendingPrepared(es, "advance")).toEqual({ amount: 10_000, channels: ["garanti"] });
  });

  it("birden çok kayıt toplanır, kanal bir kez yazılır", () => {
    const es = [entry({ amount: 1_250.5 }), entry({ amount: 749.5 })];
    expect(pendingPrepared(es, "payment2")).toEqual({ amount: 2_000, channels: ["garanti"] });
  });

  it("hazırlanmış talimat ödenmiş sayılmadığı için kişi Ödeme 2 listesinde kalır", () => {
    const line: LineInput = {
      base_salary: 60_000,
      commission_profile: "none",
      overtime_hours: 0,
      own_revenue_nd: null,
      own_revenue_denim: null,
      own_revenue: null,
      own_target: null,
      achievement_accepted: null,
      commission_override: null,
      commission_note: null,
      perfume_units: 0,
      garment_units: 0,
      top_seller: false,
      extra_premium: 10_000,
      extra_premium_note: "ek prim",
      paid_month_early: false,
      status: "active",
    };
    const paid1 = entry({ category: "payment1", amount: 60_000, batch: { id: "p1", status: "sent", title: "" } });
    const store = { revenue: null, target: null };
    // Garanti talimatı hazırlandı, gönderilmedi → 10.000 hâlâ ödenecek görünür
    expect(computeLine(line, store, [paid1, entry({})]).payment2_due).toBe(10_000);
    // Nakit ödendi olarak işlenince (talimatsız kayıt) kapanır
    expect(computeLine(line, store, [paid1, entry({ batch: { id: "c1", status: "sent", title: "" }, channel: "cash" })]).payment2_due).toBe(0);
    // İkisi birden "ödendi" olursa çift ödeme: Net Kalan eksiye düşer
    const both = computeLine(line, store, [paid1, entry({ batch: { id: "g1", status: "sent", title: "" } }), entry({ batch: { id: "c1", status: "sent", title: "" }, channel: "cash" })]);
    expect(both.net_remaining).toBe(-10_000);
  });
});
