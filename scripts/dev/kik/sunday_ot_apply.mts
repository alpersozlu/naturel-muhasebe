// Sunday work above 8 hours → September payroll overtime (owner's instruction, 05.10.2026).
// MODE=dry  : everything runs inside a transaction that is rolled back (nothing is written).
// MODE=apply: writes through the app's own audited procedure (payroll.lines.update).
// Source: a fresh Kolay İK month reading (real server function, live data, read-only).
import { readFileSync, writeFileSync } from "node:fs";
const MODE = process.env.MODE ?? "dry";
const DIR = process.env.KIK_DIR!;
const FRESH = process.env.FRESH === "1";
const { stats } = await import(DIR + "/shim.mjs");
const { prisma } = await import("@/lib/prisma");
const { appRouter } = await import("@/server/trpc/routers/_app");
const { kolayikMonth } = await import("@/server/services/kolayik/payroll-sync");
const { loadPeriodView } = await import("@/server/services/payroll/period");

const YEAR = 2026, MONTH = 9;
const isSunday = (iso: string) => new Date(`${iso}T00:00:00.000Z`).getUTCDay() === 0;
const dm = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
const tl = (v: number) => new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const hh = (v: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(v);
const HOLD = new Set((process.env.HOLD ?? "").split("|").filter(Boolean)); // names not to write (reported instead)

const month = FRESH ? await kolayikMonth(prisma, YEAR, MONTH) : JSON.parse(readFileSync(DIR + "/month_sep_v3.json", "utf8"));
if (!month.ok || month.warnings.length) throw new Error(`Kolay İK okuması eksik: ${month.error ?? ""} ${JSON.stringify(month.warnings)}`);
if (FRESH) writeFileSync(DIR + "/month_sep_apply.json", JSON.stringify(month, null, 1));
console.log(`Kolay İK okuması: ${month.fetched_at} (${FRESH ? `canlı, ${stats.calls} çağrı` : "kayıtlı"})`);

type Plan = { name: string; line_id: string | null; hours: number; waiting: number; weekday: number; note: string; short: boolean; days: string };
const plans: Plan[] = [];
for (const o of month.overtime) {
  const sun = o.entries.filter((e: any) => isSunday(e.date) && e.paid_hours > 0).sort((a: any, b: any) => a.date.localeCompare(b.date));
  const ok = sun.filter((e: any) => e.status === "approved");
  const hours = Math.round(ok.reduce((s: number, e: any) => s + e.paid_hours, 0) * 100) / 100;
  const waiting = Math.round(sun.filter((e: any) => e.status === "waiting").reduce((s: number, e: any) => s + e.paid_hours, 0) * 100) / 100;
  if (hours <= 0 && waiting <= 0) continue;
  const days = ok.map((e: any) => `${dm(e.date)} ${hh(e.paid_hours)} s`).join(", ");
  plans.push({
    name: o.person_name,
    line_id: o.line_id,
    hours,
    waiting,
    weekday: Math.round((o.approved_hours - hours) * 100) / 100,
    short: ok.some((e: any) => !e.credit_day),
    days,
    note: `Pazar mesaisi 8 saat üstü: ${days} = ${hh(hours)} saat (pazarın 8 saati hak günüdür, ücrete girmez)`,
  });
}
plans.sort((a, b) => a.name.localeCompare(b.name, "tr"));
const table = plans.map((p) => `${p.name}|${p.hours}|${p.days}`).join("\n");
if (MODE === "apply") {
  const expected = readFileSync(DIR + "/sunday_ot_plan.txt", "utf8");
  if (expected !== table) throw new Error("Kolay İK kayıtları denemeden bu yana değişmiş — önce yeniden deneme çalıştırılmalı.\n" + table);
} else writeFileSync(DIR + "/sunday_ot_plan.txt", table);

const admin = await prisma.user.findFirst({ where: { role: "admin", is_active: true, deleted_at: null, email: process.env.OWNER_EMAIL } });
if (!admin) throw new Error("yönetici kullanıcı bulunamadı");
const period = await prisma.payrollPeriod.findUniqueOrThrow({ where: { year_month: { year: YEAR, month: MONTH } } });
if (period.status !== "open") throw new Error("Eylül dönemi kapalı");

const lineMap = (v: any) => new Map<string, any>(v.stores.flatMap((s: any) => s.lines.map((l: any) => [l.id, { ...l, store: s.store_name }])));
const run = async (db: any) => {
  const before = await loadPeriodView(db, period.id);
  const b = lineMap(before);
  const caller = appRouter.createCaller({ user: { ...admin, authUserId: admin.id, email: admin.email }, prisma: db } as any);
  const done: Plan[] = [], held: Plan[] = [];
  for (const p of plans) {
    if (p.hours <= 0) continue;
    const cur = p.line_id ? b.get(p.line_id) : null;
    if (!cur) throw new Error(`${p.name}: Eylül bordro satırı yok`);
    if (HOLD.has(p.name)) { held.push(p); continue; }
    if (cur.overtime_hours !== 0) throw new Error(`${p.name}: satırda zaten ${cur.overtime_hours} saat mesai var — üstüne yazılmadı`);
    await caller.payroll.lines.update({ id: p.line_id!, overtime_hours: p.hours, overtime_note: p.note });
    done.push(p);
  }
  const after = await loadPeriodView(db, period.id);
  const a = lineMap(after);
  let sumH = 0, sumAmt = 0;
  console.log("\nMağaza | Çalışan | Pazarlar | Saat | Saatlik | Tutar | Kalan (önce → sonra) | Hafta içi onaylı (işlenmedi)");
  for (const p of done) {
    const x = b.get(p.line_id!), y = a.get(p.line_id!);
    sumH += p.hours; sumAmt += y.calc.overtime_amount;
    console.log(`${y.store} | ${y.full_name} | ${p.days}${p.short ? " [yalnız ek saat yazılmış]" : ""} | ${hh(p.hours)} | ${tl(y.calc.hourly_rate)} | ${tl(y.calc.overtime_amount)} | ${tl(x.calc.net_remaining)} → ${tl(y.calc.net_remaining)} | ${p.weekday ? hh(p.weekday) + " s" : "—"}`);
    if (Math.abs(y.calc.net_remaining - x.calc.net_remaining - y.calc.overtime_amount) > 0.011) throw new Error(`${p.name}: kalan beklenen kadar değişmedi`);
    if (y.overtime_hours !== p.hours) throw new Error(`${p.name}: saat yazılmadı`);
  }
  console.log(`TOPLAM: ${done.length} kişi · ${hh(sumH)} saat · ${tl(Math.round(sumAmt * 100) / 100)} ₺`);
  for (const p of held) { const x = b.get(p.line_id!); console.log(`BEKLETİLDİ: ${x.store} | ${x.full_name} | ${p.days} = ${hh(p.hours)} s | saatlik ${tl(x.calc.hourly_rate)} → ${tl(Math.round(x.calc.hourly_rate * p.hours * 100) / 100)} ₺ | durum ${x.employee_status} | kalan ${tl(x.calc.net_remaining)}`); }
  // untouched lines must be identical
  let drift = 0;
  for (const [id, x] of b) { const y = a.get(id); if (!done.some((p) => p.line_id === id) && (y.overtime_hours !== x.overtime_hours || Math.abs(y.calc.net_remaining - x.calc.net_remaining) > 0.001)) drift += 1; }
  console.log(`dokunulmayan satırlarda değişiklik: ${drift} · dönem toplamı mesai ${tl(before!.totals.overtime)} → ${tl(after!.totals.overtime)} · kalan ${tl(before!.totals.remaining)} → ${tl(after!.totals.remaining)} · uyarı ${before!.totals.warnings} → ${after!.totals.warnings}`);
  const newAlerts = after!.alerts.filter((x: any) => !before!.alerts.some((y: any) => y.line_id === x.line_id && y.code === x.code));
  if (newAlerts.length) console.log("yeni uyarılar:", newAlerts.map((x: any) => `${x.full_name}: ${x.text}`).join(" ; "));
  return done.length;
};

if (MODE === "apply") {
  const n = await run(prisma);
  console.log(`\nYAZILDI: ${n} satır.`);
} else {
  const ROLLBACK = new Error("ROLLBACK");
  try {
    await prisma.$transaction(async (tx: any) => { await run(tx); throw ROLLBACK; }, { timeout: 60_000 });
  } catch (e) { if (e !== ROLLBACK) throw e; }
  const still = await prisma.payrollLine.count({ where: { period_id: period.id, overtime_hours: { gt: 0 } } });
  console.log(`\nDENEME geri alındı — bordroda mesaisi dolu satır sayısı: ${still} (0 olmalı)`);
}
const waitingOnes = plans.filter((p) => p.waiting > 0);
if (waitingOnes.length) console.log("onay bekleyen pazar fazlası:", waitingOnes.map((p) => `${p.name} ${p.waiting} s`).join(", "));
await prisma.$disconnect();
