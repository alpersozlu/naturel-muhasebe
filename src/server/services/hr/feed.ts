import { addDays } from "./dates";
import type { LeaveKind } from "./rules";

/**
 * AJANDA — saf hesap. Kolay İK'nın ana sayfasındaki akışın (izinde olanlar,
 * doğum günü, iş yıldönümü; sahibi 22.10.2026) gelişmişi: mağaza etiketi,
 * resmi tatil, hak günü son günü, belge bitişi ve günün kadro durumu.
 *
 * Gizlilik: personel izin TÜRÜNÜ görmez (hastalık kimsenin işi değil) —
 * yalnız "izinli"; hak günü / belge uyarıları yalnız müdür ve sahibine.
 */

export type FeedViewer = "admin" | "manager" | "staff";

export type FeedPerson = {
  id: string;
  name: string;
  store: string;
  storeId: string;
  hireDate: string | null;
  birthDate: string | null;
  workPermitExpiry?: string | null;
  passportExpiry?: string | null;
};

export type FeedLeave = { employeeId: string; kind: LeaveKind; start: string; end: string; halfDay: boolean };
export type FeedCredit = { employeeId: string; date: string; deadline: string };

export type FeedItem =
  | { type: "leave"; date: string; personId: string; name: string; store: string; kind: LeaveKind | null; halfDay: boolean; until: string }
  | { type: "birthday"; date: string; personId: string; name: string; store: string }
  | { type: "anniversary"; date: string; personId: string; name: string; store: string; years: number }
  | { type: "holiday"; date: string; name: string }
  | { type: "lieu_deadline"; date: string; personId: string; name: string; store: string; worked: string }
  | { type: "document"; date: string; personId: string; name: string; store: string; doc: "work_permit" | "passport" };

export type FeedDay = { date: string; items: FeedItem[] };
export type StoreToday = { storeId: string; store: string; total: number; away: number };

/** O yılın karşılığı (29 Şubat → 28 Şubat) */
function inYear(md: string, year: number): string {
  const d = `${year}-${md}`;
  return md === "02-29" && new Date(`${year}-03-01T00:00:00Z`).getTime() - new Date(`${year}-02-28T00:00:00Z`).getTime() === 86_400_000 ? `${year}-02-28` : d;
}

export function buildFeed(i: {
  today: string;
  days: number;
  viewer: FeedViewer;
  people: FeedPerson[];
  leaves: FeedLeave[];
  holidays: Array<{ date: string; name: string }>;
  credits: FeedCredit[];
}): { days: FeedDay[]; stores: StoreToday[] } {
  const end = addDays(i.today, i.days - 1);
  const inRange = (d: string) => d >= i.today && d <= end;
  const byId = new Map(i.people.map((p) => [p.id, p]));
  const items: FeedItem[] = [];
  const years = [Number(i.today.slice(0, 4)), Number(end.slice(0, 4))];
  const private_ = i.viewer === "staff";

  for (const h of i.holidays) if (inRange(h.date)) items.push({ type: "holiday", date: h.date, name: h.name });

  for (const p of i.people) {
    const base = { personId: p.id, name: p.name, store: p.store };
    if (p.birthDate) {
      for (const y of Array.from(new Set(years))) {
        const d = inYear(p.birthDate.slice(5), y);
        if (inRange(d)) items.push({ type: "birthday", date: d, ...base });
      }
    }
    if (p.hireDate) {
      for (const y of Array.from(new Set(years))) {
        const d = inYear(p.hireDate.slice(5), y);
        const n = y - Number(p.hireDate.slice(0, 4));
        if (n > 0 && inRange(d)) items.push({ type: "anniversary", date: d, years: n, ...base });
      }
    }
    if (!private_) {
      for (const [doc, d] of [
        ["work_permit", p.workPermitExpiry],
        ["passport", p.passportExpiry],
      ] as const) {
        if (d && inRange(d)) items.push({ type: "document", date: d, doc, ...base });
      }
    }
  }

  // İzin: aralıkta geçtiği her gün değil, BAŞLADIĞI gün (ya da bugün sürüyorsa bugün) — akış kalabalıklaşmasın
  for (const l of i.leaves) {
    const p = byId.get(l.employeeId);
    if (!p || l.end < i.today || l.start > end) continue;
    const date = l.start < i.today ? i.today : l.start;
    items.push({ type: "leave", date, personId: p.id, name: p.name, store: p.store, kind: private_ ? null : l.kind, halfDay: l.halfDay, until: l.end });
  }

  if (!private_) {
    for (const c of i.credits) {
      const p = byId.get(c.employeeId);
      if (p && inRange(c.deadline)) items.push({ type: "lieu_deadline", date: c.deadline, personId: p.id, name: p.name, store: p.store, worked: c.date });
    }
  }

  const order: Record<FeedItem["type"], number> = { holiday: 0, leave: 1, lieu_deadline: 2, document: 3, birthday: 4, anniversary: 5 };
  const days: FeedDay[] = [];
  for (let d = i.today; d <= end; d = addDays(d, 1)) {
    const list = items.filter((x) => x.date === d).sort((a, b) => order[a.type] - order[b.type]);
    if (list.length) days.push({ date: d, items: list });
  }

  // Bugün mağazada: kadro − bugün izinde olanlar
  const stores = new Map<string, StoreToday>();
  for (const p of i.people) {
    const s = stores.get(p.storeId) ?? { storeId: p.storeId, store: p.store, total: 0, away: 0 };
    s.total += 1;
    if (i.leaves.some((l) => l.employeeId === p.id && l.start <= i.today && l.end >= i.today && !l.halfDay)) s.away += 1;
    stores.set(p.storeId, s);
  }
  return { days, stores: Array.from(stores.values()) };
}

/** "19–25 Ekim" hafta başlığı için haftanın pazartesisi */
export function weekStart(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
}

