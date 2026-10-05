import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listLeaves, listOvertime } from "@/server/services/kolayik/client";

/**
 * Kolay İK listeleri sessizce kesilir: mesai listesi "limit" ne olursa olsun
 * sayfa başına 15 kayıt döner, izin listesi 100'de durur ve sayfalanmaz
 * (05.10.2026'da ölçüldü — prim ekranı Eylül mesailerinin yalnız ilk 15'ini
 * görüyordu). İstemci bütün kayıtları okumalı.
 */
const day = (n: number) => new Date(Date.UTC(2026, 8, n)).toISOString().slice(0, 10); // Eylül'ün n. günü
const timelogs = Array.from({ length: 73 }, (_, i) => ({
  id: `t${i}`,
  startDate: `${day(1 + (i % 30))}T18:30:00`,
  endDate: `${day(1 + (i % 30))}T20:30:00`,
  usedMinute: 120,
  personId: "p",
  status: "approved",
  type: "overtime",
}));
const leaves = Array.from({ length: 140 }, (_, i) => ({
  id: `l${i}`,
  startDate: `${day(1 + (i % 30))} 09:00:00`,
  endDate: `${day(1 + (i % 30))} 18:30:00`,
  status: "approved",
  usedDays: "1",
  person: { id: "p", name: "P" },
}));
let calls: string[] = [];

beforeEach(() => {
  calls = [];
  process.env.KOLAYIK_API_TOKEN = "test";
  vi.stubGlobal("fetch", async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    const q = url.searchParams;
    const from = (q.get("startDate") ?? "").slice(0, 10);
    const to = (q.get("endDate") ?? "").slice(0, 10);
    const inWindow = (iso: string) => iso.slice(0, 10) >= from && iso.slice(0, 10) <= to;
    let data: unknown;
    if (url.pathname === "/v2/timelog/list") {
      const all = timelogs.filter((t) => inWindow(t.startDate)).sort((a, b) => a.startDate.localeCompare(b.startDate));
      const page = Number(q.get("page") ?? 1);
      const items = all.slice((page - 1) * 15, page * 15); // "limit" yok sayılır
      data = { items, totalCount: items.length, searchCount: items.length, page, limit: Number(q.get("limit")) };
    } else {
      const all = q.get("status") === "approved" ? leaves.filter((l) => inWindow(l.startDate)) : [];
      data = all.slice(0, 100); // sayfalama yok, 100'de kesilir
    }
    return new Response(JSON.stringify({ error: false, data }), { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Kolay İK istemcisi — kesilen listeler", () => {
  it("mesai: bütün sayfalar okunur (15'te durmaz)", async () => {
    const got = await listOvertime("2026-09-01", "2026-09-30");
    expect(got).toHaveLength(73);
    expect(new Set(got.map((t) => t.id)).size).toBe(73);
    expect(got[0]!.startDate <= got[got.length - 1]!.startDate).toBe(true);
  });

  it("izin: aralık haftalık dilimlerle okunur, 100 sınırına takılmaz", async () => {
    const got = await listLeaves("2026-09-01", "2026-09-30");
    expect(got).toHaveLength(140);
    // her dilim kendi başına 100'ün altında kalmalı
    expect(calls.filter((c) => c.startsWith("/v2/leave/list")).length).toBeGreaterThanOrEqual(5);
  });
});
