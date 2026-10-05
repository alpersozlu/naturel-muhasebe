/**
 * PAZAR ÇALIŞMASI ↔ HAK GÜNÜ DENETİMİ — saf hesap, ağ ve veritabanı yok.
 *
 * KURAL (sahibi, 05.10.2026): "Pazar günü çalışan personele 8 saat, yani 1 gün
 * izin veriyoruz; kullanmak zorundadır. İzin günleri içeride birikmemeli."
 *
 * Kolay İK'da bu iki AYRI listede iz bırakır (Eylül 2026 kayıtlarıyla ölçüldü):
 *   • Pazar çalışması  → "mesai" (timelog/overtime) kaydı, o pazar tarihli.
 *       480 dk  = 8 saat = 1 hak günü. Üstü (600, 660…) = molasız çalışılan
 *       ek saat; ÜCRET olarak ödenir, hak gününe girmez. Bazı kişiler yalnız
 *       ek saati girer (120 / 180 dk; "Pazar ek mesai", "1.5 x2 ek Pazar").
 *       Sahibi (05.10.2026): "normalde 8 saat yazarlar, ek mesai yaptılarsa
 *       8 saate eklerler, bazen 10 saat yazarlar; Selbi onun yerine kaç saat
 *       ek mesai yaptıysa onu yazmış." → pazar ÇALIŞILMIŞ sayılır, girilen
 *       saatin tamamı ücrettir; kayıt 8 + ek saat olarak düzeltilmelidir.
 *   • Karşılığında kullanılan gün → "Yıllık İzin" türünde tek günlük izin.
 *       Kolay İK'da hak günü için ayrı tür YOK; ayıran tek şey açıklama:
 *       "Pazar mesai izni", "Haftalık izin", "20.09.2026 pazar günü
 *       çalıştığım için…". Gerçek yıllık izin ve hastalık da aynı türde
 *       görünebilir.
 *   Karşılık günü pazarın ARDINDAN, çoğunlukla izleyen hafta içinde alınır.
 *
 * EŞLEŞTİRME. Önce açıklamasında tarih yazan izinler o pazara bağlanır. Sonra
 * her karşılık günü, kendisinden önceki EN YAKIN (en çok 13 gün) eşleşmemiş
 * pazara verilir: önce "pazar / haftalık" diyenler, sonra açıklaması bir şey
 * söylemeyen tek günlük izinler ("muhtemel"). Açıklaması "yıllık izin" diyen
 * gün karşılık sayılMAZ (Meltem D. 15.09.2026: yıllık izin haftasının ilk
 * günüydü) — yalnız not olarak gösterilir. Eşleşmeyen pazar = kullanılmamış
 * hak günü; izleyen hafta henüz bitmediyse "süresi dolmadı".
 */

export type AuditOvertime = {
  id: string;
  personId: string;
  /** YYYY-MM-DD — çalışılan gün */
  date: string;
  minutes: number;
  status: string; // approved | waiting | rejected
  description: string | null;
  /** YYYY-MM-DD — kaydın girildiği gün */
  createdAt: string;
};

export type AuditLeave = {
  id: string;
  personId: string;
  start: string; // YYYY-MM-DD
  end: string;
  days: number;
  status: string; // approved | waiting
  type: string;
  comment: string | null;
};

export type RestConfidence = "explicit" | "labelled" | "probable";
export type SundayState = "used" | "waiting" | "pending" | "unused";

export type SundayRow = {
  date: string;
  /** O pazara girilen toplam mesai dakikası; kayıt yoksa null */
  minutes: number | null;
  /** 8 saatlik (480 dk) pazar kaydı var mı */
  has_8h: boolean;
  overtime_status: "approved" | "waiting" | null;
  /** Çalışmanın nereden bilindiği */
  source: "overtime" | "leave_comment" | "misfiled_leave";
  /** Kayıt pazardan kaç gün sonra girildi */
  entered_after_days: number | null;
  /** Ücret olarak ödenecek kısım: 480'in üstü; 8 saat girilmediyse girilen dakikanın tamamı */
  paid_minutes: number;
  rest: { leave_id: string; date: string; status: "approved" | "waiting"; comment: string | null; confidence: RestConfidence } | null;
  state: SundayState;
  notes: string[];
};

export type OrphanRest = { leave_id: string; date: string; status: string; comment: string | null };

export type PersonAudit = {
  person_id: string;
  sundays: SundayRow[];
  /** Ay içinde "pazar / haftalık" diye alınmış ama karşılığında çalışılmış pazar görünmeyen günler */
  orphan_rests: OrphanRest[];
  issues: string[];
  counts: { worked: number; with_8h: number; used: number; waiting: number; pending: number; unused: number };
};

export type SundayAudit = {
  year: number;
  month: number;
  sundays: string[];
  today: string;
  people: PersonAudit[];
  totals: { people: number; worked: number; with_8h: number; used: number; waiting: number; pending: number; unused: number };
};

/** Bir gün hak günü sayılır: 8 saat ve üstü, pazar ya da resmî tatil. */
export const CREDIT_MINUTES = 480;
const MATCH_WINDOW_DAYS = 13;

const DAY = 86_400_000;
const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(toDate(s).getTime() + n * DAY));
const diffDays = (a: string, b: string) => Math.round((toDate(a).getTime() - toDate(b).getTime()) / DAY);
const isSunday = (s: string) => toDate(s).getUTCDay() === 0;
const tr = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;

/** Türkçe küçük harf + aksansız — "HaftaLık ızın", "Yillik izin" aynı okunur. */
export function fold(s: string | null | undefined): string {
  return (s ?? "")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/\s+/g, " ")
    .trim();
}

export function sundaysOfMonth(year: number, month: number): string[] {
  const out: string[] = [];
  for (let d = new Date(Date.UTC(year, month - 1, 1)); d.getUTCMonth() === month - 1; d = new Date(d.getTime() + DAY)) {
    if (d.getUTCDay() === 0) out.push(iso(d));
  }
  return out;
}

/** Resmî tatilde çalışma da hak günüdür (açıklamadan anlaşılır). */
export function isHolidayNote(description: string | null | undefined): boolean {
  return /resmi tatil|bayram/.test(fold(description));
}

/**
 * Bir mesai kaydının ÜCRETE giren kısmı: pazar / resmî tatilde 8 saat ve üstü
 * girildiyse ilk 480 dk hak günüdür, kalanı ödenir; diğer her kayıt tamamen ödenir.
 * `rest_day`: kayıt pazar / resmî tatil gününe ait — ödenen kısmı "pazar 8 saat
 * üstü" mesaisidir (8 saatin altında girilmişse yalnız ek saat yazılmış demektir).
 */
export function splitOvertime(o: Pick<AuditOvertime, "date" | "minutes" | "description">): {
  credit_day: boolean;
  paid_minutes: number;
  rest_day: boolean;
} {
  const rest = isSunday(o.date) || isHolidayNote(o.description);
  const credit = rest && o.minutes >= CREDIT_MINUTES;
  return { credit_day: credit, paid_minutes: credit ? o.minutes - CREDIT_MINUTES : o.minutes, rest_day: rest };
}

/** 120 → "2", 90 → "1,5" */
const hoursTr = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100).replace(".", ",");

export type LeaveClass = "sick" | "worklog" | "inlieu" | "annual" | "unknown";

/** İzin açıklamasından tür ve (yazıyorsa) hangi pazarın karşılığı olduğu. */
export function classifyLeave(l: Pick<AuditLeave, "start" | "comment" | "type">): { cls: LeaveClass; refs: string[] } {
  const c = fold(l.comment);
  const refs: string[] = [];
  for (const m of Array.from(c.matchAll(/(\d{1,2})[./](\d{1,2})[./](\d{4})/g))) {
    const d = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
    if (!Number.isNaN(toDate(d).getTime()) && isSunday(d)) refs.push(d);
  }
  // "6 sındaki pazar mesaisinin karşılığı" — ay yazmıyor: iznin kendi ayı, gün ileriyse önceki ay
  const dayOnly = c.match(/(\d{1,2})\s*'?\s*s[iu]ndaki pazar/);
  if (dayOnly && refs.length === 0) {
    const day = Number(dayOnly[1]);
    const start = toDate(l.start);
    let cand = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day));
    if (cand.getTime() >= start.getTime()) cand = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, day));
    if (cand.getUTCDate() === day && isSunday(iso(cand))) refs.push(iso(cand));
  }
  if (/hastal/.test(fold(l.type)) || /hasta|rapor/.test(c)) return { cls: "sick", refs: [] };
  // Çalışma dökümü ("Giriş 10:30 Çıkış 20:00") izin olarak girilmiş
  if (/giris/.test(c) && /cikis/.test(c)) return { cls: "worklog", refs: [] };
  if (refs.length > 0 || /pazar|hafta/.test(c)) return { cls: "inlieu", refs };
  if (/yil+ik/.test(c)) return { cls: "annual", refs };
  return { cls: "unknown", refs };
}

type Worked = { date: string; minutes: number | null; status: "approved" | "waiting" | null; source: SundayRow["source"]; createdAt: string | null; misfiledLeave?: AuditLeave };
type Candidate = { leave: AuditLeave; date: string; cls: LeaveClass; refs: string[]; taken: boolean };

function auditPerson(personId: string, overtime: AuditOvertime[], leaves: AuditLeave[], monthSundays: string[], today: string): PersonAudit {
  // ── Çalışılan pazarlar (veri penceresinin tamamı; rapora yalnız ay girer) ──
  const worked = new Map<string, Worked>();
  for (const o of overtime) {
    if (o.status === "rejected" || !isSunday(o.date)) continue;
    const w = worked.get(o.date) ?? { date: o.date, minutes: 0, status: null, source: "overtime" as const, createdAt: o.createdAt };
    w.minutes = (w.minutes ?? 0) + o.minutes;
    // Bir kaydı bile onay bekliyorsa o pazar "bekliyor" sayılır
    w.status = o.status === "approved" && w.status !== "waiting" ? "approved" : "waiting";
    if (o.createdAt > (w.createdAt ?? "")) w.createdAt = o.createdAt;
    worked.set(o.date, w);
  }

  const candidates: Candidate[] = [];
  const sickAsAnnual: AuditLeave[] = [];
  for (const l of leaves) {
    if (l.status !== "approved" && l.status !== "waiting") continue;
    const { cls, refs } = classifyLeave(l);
    if (cls === "sick") {
      if (!/hastal/.test(fold(l.type))) sickAsAnnual.push(l);
      continue;
    }
    if (cls === "worklog") {
      // Pazar çalışması mesai yerine İZİN olarak girilmiş
      if (isSunday(l.start) && !worked.has(l.start)) {
        worked.set(l.start, { date: l.start, minutes: null, status: null, source: "misfiled_leave", createdAt: null, misfiledLeave: l });
      }
      continue;
    }
    // Açıklamasında adı geçen pazar: mesai kaydı olmasa da çalışılmış sayılır
    for (const r of refs) {
      if (!worked.has(r)) worked.set(r, { date: r, minutes: null, status: null, source: "leave_comment", createdAt: null });
    }
    // Çok günlük izin: "pazar karşılığı" diyorsa yalnız İLK günü karşılık günüdür; demiyorsa yıllık izindir.
    if (l.days > 1 && cls !== "inlieu") continue;
    candidates.push({ leave: l, date: l.start, cls, refs, taken: false });
  }
  candidates.sort((a, b) => a.date.localeCompare(b.date));

  const matched = new Map<string, { c: Candidate; confidence: RestConfidence }>();
  // 1) Açıklamasında tarihi yazanlar
  for (const c of candidates) {
    const target = c.refs.find((r) => worked.has(r) && !matched.has(r));
    if (target) {
      matched.set(target, { c, confidence: "explicit" });
      c.taken = true;
    }
  }
  // 2) Kalan karşılık günleri: kendinden önceki en yakın eşleşmemiş pazara
  const pass = (cls: LeaveClass, confidence: RestConfidence, maxGap: number) => {
    for (const c of candidates) {
      if (c.taken || c.cls !== cls) continue;
      const target = Array.from(worked.keys())
        .filter((s) => !matched.has(s) && s < c.date && diffDays(c.date, s) <= maxGap)
        .sort()
        .pop();
      if (target) {
        matched.set(target, { c, confidence });
        c.taken = true;
      }
    }
  };
  pass("inlieu", "labelled", MATCH_WINDOW_DAYS);
  pass("unknown", "probable", MATCH_WINDOW_DAYS);

  // ── Ayın pazarları ──
  const rows: SundayRow[] = [];
  for (const s of monthSundays) {
    const w = worked.get(s);
    if (!w) continue;
    const notes: string[] = [];
    const has8 = (w.minutes ?? 0) >= CREDIT_MINUTES;
    if (w.source === "misfiled_leave") notes.push("Pazar çalışması mesai yerine İZİN olarak girilmiş — bakiyeden 1 gün yanlışlıkla düşmüş; izin silinip 8 saat mesai girilmeli");
    else if (w.source === "leave_comment") notes.push("Mesai kaydı yok — çalışıldığı yalnız izin açıklamasından anlaşılıyor");
    else if (!has8) notes.push(`Yalnız ek mesai yazılmış (${hoursTr(w.minutes ?? 0)} saat, ücrete girer) — pazarın 8 saati ayrıca girilmemiş; kayıt 8 + ek saat olarak düzeltilmeli`);
    if (w.status === "waiting") notes.push("Mesai kaydı onay bekliyor");
    const after = w.createdAt ? diffDays(w.createdAt, s) : null;
    if (after != null && after > 7) notes.push(`Mesai ${after} gün sonra girilmiş`);

    const m = matched.get(s);
    let state: SundayState;
    if (m) {
      state = m.c.leave.status === "approved" ? "used" : "waiting";
      if (state === "waiting") notes.push("İzin talebi onay bekliyor — bakiyeden henüz düşülmedi");
      if (m.confidence === "probable") notes.push("İzin açıklaması pazar karşılığı olduğunu söylemiyor (muhtemel eşleşme)");
      if (m.c.leave.days > 1) notes.push(`İzin ${m.c.leave.days} gün — ilk günü pazar karşılığı sayıldı`);
    } else {
      state = diffDays(today, s) <= 6 ? "pending" : "unused";
      // Ardından çok günlük yıllık izne çıkıldıysa karşılık günü onun içinde erimiş olabilir
      const block = leaves.find(
        (l) => (l.status === "approved" || l.status === "waiting") && l.days > 1 && l.start > s && diffDays(l.start, s) <= 6 && classifyLeave(l).cls !== "sick"
      );
      if (block) notes.push(`Hemen ardından ${tr(block.start)}–${tr(block.end)} ${block.days} günlük izin var — karşılık günü ayrıca gösterilmemiş`);
      // Açıklaması "yıllık izin" diyen tek günlük izin karşılık sayılmaz; ama görünür olsun
      const annual = candidates.filter((c) => !c.taken && c.cls === "annual" && c.date > s && diffDays(c.date, s) <= MATCH_WINDOW_DAYS);
      if (annual.length) {
        notes.push(`${annual.map((c) => tr(c.date)).join(", ")} tarihinde tek günlük “yıllık izin” var — pazar karşılığıysa açıklaması düzeltilmeli`);
      }
    }
    rows.push({
      date: s,
      minutes: w.minutes,
      has_8h: has8,
      overtime_status: w.status,
      source: w.source,
      entered_after_days: after,
      paid_minutes: w.minutes == null ? 0 : has8 ? w.minutes - CREDIT_MINUTES : w.minutes,
      rest: m
        ? { leave_id: m.c.leave.id, date: m.c.date, status: m.c.leave.status as "approved" | "waiting", comment: m.c.leave.comment, confidence: m.confidence }
        : null,
      state,
      notes,
    });
  }

  // Ay içinde "pazar / haftalık" diye alınmış, ama önünde çalışılmış pazar görünmeyen günler.
  // Ayın ilk pazarından önceki günler önceki ayın pazarına aittir — raporlanmaz.
  const firstSunday = monthSundays[0] ?? "9999-12-31";
  const monthEndPlus = addDays(monthSundays[monthSundays.length - 1] ?? "0000-01-01", MATCH_WINDOW_DAYS);
  const orphan_rests: OrphanRest[] = candidates
    .filter((c) => !c.taken && c.cls === "inlieu" && c.date > firstSunday && c.date <= monthEndPlus)
    .filter((c) => {
      const prevSunday = addDays(c.date, -((toDate(c.date).getUTCDay() + 7) % 7 || 7));
      return monthSundays.includes(prevSunday) || monthSundays.includes(addDays(prevSunday, -7));
    })
    .map((c) => ({ leave_id: c.leave.id, date: c.date, status: c.leave.status, comment: c.leave.comment }));

  const issues: string[] = [];
  const count = (f: (r: SundayRow) => boolean) => rows.filter(f).length;
  const unused = rows.filter((r) => r.state === "unused");
  if (unused.length) issues.push(`${unused.length} pazarın karşılığı kullanılmamış (${unused.map((r) => tr(r.date)).join(", ")})`);
  const no8 = rows.filter((r) => !r.has_8h && r.source === "overtime");
  if (no8.length) issues.push(`${no8.length} pazarda yalnız ek mesai yazılmış, 8 saat girilmemiş (${no8.map((r) => tr(r.date)).join(", ")})`);
  for (const r of rows.filter((x) => x.source === "misfiled_leave")) issues.push(`${tr(r.date)} pazar çalışması izin olarak girilmiş (yanlış)`);
  for (const r of rows.filter((x) => x.source === "leave_comment")) issues.push(`${tr(r.date)} pazarı için mesai kaydı yok`);
  if (orphan_rests.length) issues.push(`${orphan_rests.length} gün “pazar / haftalık izin” alınmış ama karşılığında çalışılmış pazar kaydı yok (${orphan_rests.map((o) => tr(o.date)).join(", ")})`);
  const sickInMonth = sickAsAnnual.filter((l) => l.start >= `${monthSundays[0]?.slice(0, 7) ?? ""}-01` && l.start.slice(0, 7) === (monthSundays[0] ?? "").slice(0, 7));
  if (sickInMonth.length) {
    issues.push(
      `${sickInMonth.length} gün hastalık izni “Yıllık İzin” türünde girilmiş — yıllık izinden düşmüş (${sickInMonth
        .map((l) => l.start)
        .sort()
        .map(tr)
        .join(", ")})`
    );
  }

  return {
    person_id: personId,
    sundays: rows,
    orphan_rests,
    issues,
    counts: {
      worked: rows.length,
      with_8h: count((r) => r.has_8h),
      used: count((r) => r.state === "used"),
      waiting: count((r) => r.state === "waiting"),
      pending: count((r) => r.state === "pending"),
      unused: unused.length,
    },
  };
}

export function buildSundayAudit(input: {
  year: number;
  month: number;
  today: string;
  personIds: string[];
  overtime: AuditOvertime[];
  leaves: AuditLeave[];
}): SundayAudit {
  const sundays = sundaysOfMonth(input.year, input.month);
  const people = input.personIds.map((id) =>
    auditPerson(
      id,
      input.overtime.filter((o) => o.personId === id),
      input.leaves.filter((l) => l.personId === id),
      sundays,
      input.today
    )
  );
  const sum = (f: (p: PersonAudit) => number) => people.reduce((s, p) => s + f(p), 0);
  return {
    year: input.year,
    month: input.month,
    sundays,
    today: input.today,
    people,
    totals: {
      people: people.filter((p) => p.counts.worked > 0).length,
      worked: sum((p) => p.counts.worked),
      with_8h: sum((p) => p.counts.with_8h),
      used: sum((p) => p.counts.used),
      waiting: sum((p) => p.counts.waiting),
      pending: sum((p) => p.counts.pending),
      unused: sum((p) => p.counts.unused),
    },
  };
}
