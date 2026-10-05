import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KolayikError, kolayikRateInfo, kolayikTuning, leaveDaysWithin, listLeaves, listOvertime } from "@/server/services/kolayik/client";

/**
 * Kolay İK listeleri sessizce eksik döner. Sahte sunucu, canlıda ölçülen
 * davranışı taklit eder (05.10.2026):
 *  • mesai (timelog): "limit" ne olursa olsun sayfa başına 15 kayıt; kayıt
 *    pencerenin içinde başlayıp içinde BİTMELİ (gece yarısını aşan kayıt,
 *    pencerenin son gününde başlıyorsa gelmez);
 *  • izin (leave): en çok 100 kayıt, sayfalama yok; süzgeç izinin BAŞLANGICINA
 *    bakar (önceki ayda başlayıp bu aya uzanan izin gelmez);
 *  • çok istek gelince HTTP 429 "Too Many Attempts".
 * İstemci buna rağmen bütün kayıtları okumalı.
 */
type T = { id: string; startDate: string; endDate: string; usedMinute: number; personId: string; status: string; type: string };
type L = { id: string; startDate: string; endDate: string; status: string; usedDays: string; person: { id: string; name: string } };

const day = (n: number) => new Date(Date.UTC(2026, 8, n)).toISOString().slice(0, 10); // Eylül'ün n. günü (n ≤ 0 → Ağustos, n > 30 → Ekim)
const tl = (id: string, start: string, end: string, minutes = 120): T => ({ id, startDate: start, endDate: end, usedMinute: minutes, personId: "p", status: "approved", type: "overtime" });
const lv = (id: string, start: string, end: string, days: number, status = "approved"): L => ({
  id,
  startDate: `${start} 09:00:00`,
  endDate: `${end} 18:30:00`,
  status,
  usedDays: String(days),
  person: { id: "p", name: "P" },
});

let timelogs: T[] = [];
let leaves: L[] = [];
let calls: string[] = [];
let tooMany = 0; // sıradaki bu kadar isteğe 429 dön
let live = 0;
let peak = 0;
const savedWaits = [...kolayikTuning.retryWaitsMs];

beforeEach(() => {
  timelogs = [];
  leaves = [];
  calls = [];
  tooMany = 0;
  live = 0;
  peak = 0;
  kolayikTuning.retryWaitsMs = [0, 0];
  process.env.KOLAYIK_API_TOKEN = "test";
  vi.stubGlobal("fetch", async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    live += 1;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 1));
    live -= 1;
    if (tooMany > 0) {
      tooMany -= 1;
      return new Response(JSON.stringify({ error: true, message: "Too Many Attempts." }), {
        status: 429,
        headers: { "x-ratelimit-limit": "150", "x-ratelimit-remaining": "0" },
      });
    }
    const q = url.searchParams;
    const from = (q.get("startDate") ?? "").replace(" ", "T");
    const to = (q.get("endDate") ?? "").replace(" ", "T");
    let data: unknown;
    if (url.pathname === "/v2/timelog/list") {
      // kapsama: başlangıç ≥ pencere başı VE bitiş ≤ pencere sonu
      const all = timelogs.filter((t) => t.startDate >= from && t.endDate <= to).sort((a, b) => a.startDate.localeCompare(b.startDate));
      const page = Number(q.get("page") ?? 1);
      const items = all.slice((page - 1) * 15, page * 15); // "limit" yok sayılır
      data = { items, totalCount: items.length, searchCount: items.length, page, limit: Number(q.get("limit")) };
    } else {
      // izinin BAŞLANGICI pencerede olmalı; 100'de kesilir, sayfalama yok
      const all = leaves.filter((l) => l.status === q.get("status") && l.startDate.replace(" ", "T") >= from && l.startDate.replace(" ", "T") <= to);
      data = all.slice(0, 100);
    }
    return new Response(JSON.stringify({ error: false, data }), { status: 200 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  kolayikTuning.retryWaitsMs = savedWaits;
});

describe("Kolay İK istemcisi — mesai listesi", () => {
  it("bütün sayfalar okunur (15'te durmaz)", async () => {
    timelogs = Array.from({ length: 73 }, (_, i) => tl(`t${i}`, `${day(1 + (i % 30))}T18:30:00`, `${day(1 + (i % 30))}T20:30:00`));
    const got = await listOvertime("2026-09-01", "2026-09-30");
    expect(got).toHaveLength(73);
    expect(new Set(got.map((t) => t.id)).size).toBe(73);
    expect(got[0]!.startDate <= got[got.length - 1]!.startDate).toBe(true);
  });

  it("gece yarısını aşan kayıt hangi güne denk gelirse gelsin okunur (Eylül 2026: 4 kayıt eksik kalmıştı)", async () => {
    // Ayın her günü, akşam başlayıp ertesi sabaha karşı biten birer kayıt
    timelogs = Array.from({ length: 30 }, (_, i) => tl(`n${i + 1}`, `${day(i + 1)}T22:34:59`, `${day(i + 2)}T01:34:59`, 180));
    // aralık dışı: bir gün önce başlayıp ayın ilk gününde biten, ve ertesi ayın ilk günü başlayan
    timelogs.push(tl("once", `${day(0)}T23:00:00`, `${day(1)}T02:00:00`, 180), tl("sonra", `${day(31)}T10:00:00`, `${day(31)}T12:00:00`));
    const got = await listOvertime("2026-09-01", "2026-09-30");
    expect(got.map((t) => t.id).sort()).toEqual(Array.from({ length: 30 }, (_, i) => `n${i + 1}`).sort());
    // ayın son günü 23:37'de başlayıp 1 Ekim'de biten kayıt Eylül'e aittir
    expect(got.some((t) => t.startDate.startsWith("2026-09-30"))).toBe(true);
  });

  it("başlangıç gününe göre süzer: tek günlük aralıkta yalnız o gün başlayanlar", async () => {
    timelogs = [tl("a", "2026-09-20T18:00:20", "2026-09-21T04:30:20", 630), tl("b", "2026-09-21T10:00:00", "2026-09-21T12:00:00"), tl("c", "2026-09-19T20:00:00", "2026-09-19T22:00:00")];
    expect((await listOvertime("2026-09-20", "2026-09-20")).map((t) => t.id)).toEqual(["a"]);
  });
});

describe("Kolay İK istemcisi — izin listesi", () => {
  it("100 sınırına takılan dilim bölünerek okunur", async () => {
    leaves = Array.from({ length: 260 }, (_, i) => lv(`l${i}`, day(1 + (i % 30)), day(1 + (i % 30)), 1));
    const got = await listLeaves("2026-09-01", "2026-09-30");
    expect(got).toHaveLength(260);
    expect(new Set(got.map((l) => l.id)).size).toBe(260);
  });

  it("önceki ayda başlayıp aralığa uzanan izin de gelir; aralıktan önce biten gelmez", async () => {
    leaves = [
      lv("uzanan", "2026-08-31", "2026-09-05", 6), // Eylül'e uzanır
      lv("uzun", "2026-08-21", "2026-09-01", 12), // son günü Eylül'de
      lv("biten", "2026-08-24", "2026-08-29", 6), // Ağustos'ta bitti
      lv("icinde", "2026-09-07", "2026-09-12", 6),
      lv("tasan", "2026-09-28", "2026-10-03", 6), // Ekim'e taşar
      lv("sonra", "2026-10-01", "2026-10-01", 1),
      lv("bekleyen", "2026-09-18", "2026-09-19", 2, "waiting"),
    ];
    const got = await listLeaves("2026-09-01", "2026-09-30");
    expect(got.map((l) => l.id).sort()).toEqual(["bekleyen", "icinde", "tasan", "uzanan", "uzun"]);
    // geriye bakma kapatılırsa yalnız aralıkta başlayanlar
    const noLookback = await listLeaves("2026-09-01", "2026-09-30", { lookbackDays: 0 });
    expect(noLookback.map((l) => l.id).sort()).toEqual(["bekleyen", "icinde", "tasan"]);
  });

  it("ay sınırını aşan iznin yalnız o aya düşen günü sayılır", () => {
    expect(leaveDaysWithin({ start: "2026-08-31", end: "2026-09-05", days: 6 }, "2026-09-01", "2026-09-30")).toBe(5);
    expect(leaveDaysWithin({ start: "2026-08-21", end: "2026-09-01", days: 12 }, "2026-09-01", "2026-09-30")).toBe(1);
    expect(leaveDaysWithin({ start: "2026-09-28", end: "2026-10-03", days: 6 }, "2026-09-01", "2026-09-30")).toBe(3);
    expect(leaveDaysWithin({ start: "2026-09-07", end: "2026-09-12", days: 6 }, "2026-09-01", "2026-09-30")).toBe(6);
    expect(leaveDaysWithin({ start: "2026-09-15", end: "2026-09-15", days: 0.5 }, "2026-09-01", "2026-09-30")).toBe(0.5);
  });
});

describe("Kolay İK istemcisi — istek sınırı", () => {
  it("HTTP 429 gelince bekleyip yeniden dener", async () => {
    timelogs = [tl("a", "2026-09-10T18:00:00", "2026-09-10T20:00:00")];
    tooMany = 2;
    const got = await listOvertime("2026-09-10", "2026-09-10");
    expect(got.map((t) => t.id)).toEqual(["a"]);
    expect(kolayikRateInfo()?.limit).toBe(150);
  });

  it("sınır açılmazsa anlaşılır hatayla durur (eksik veriyle devam etmez)", async () => {
    tooMany = 1000;
    const err = await listLeaves("2026-09-01", "2026-09-30").then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(KolayikError);
    expect((err as KolayikError).status).toBe(429);
    expect((err as KolayikError).message).toContain("istek sınırı");
  });

  it("aynı anda en çok 4 çağrı gider", async () => {
    timelogs = Array.from({ length: 200 }, (_, i) => tl(`t${i}`, `${day(1 + (i % 30))}T18:30:00`, `${day(1 + (i % 30))}T20:30:00`));
    leaves = Array.from({ length: 90 }, (_, i) => lv(`l${i}`, day(1 + (i % 30)), day(1 + (i % 30)), 1));
    const [o, l] = await Promise.all([listOvertime("2026-08-11", "2026-10-05"), listLeaves("2026-08-11", "2026-10-14")]);
    expect(o).toHaveLength(200);
    expect(l).toHaveLength(90);
    expect(peak).toBeLessThanOrEqual(kolayikTuning.maxParallel);
    expect(calls.length).toBeLessThan(45);
  });
});
