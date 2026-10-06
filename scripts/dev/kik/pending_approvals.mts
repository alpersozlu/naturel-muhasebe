// READ-ONLY: September 2026 records still waiting for approval in Kolay İK (overtime + leave), fresh reading
// through the app's own functions; positions from the payroll table to tell store managers apart.
import { writeFileSync } from "node:fs";
const DIR = process.env.KIK_DIR!;
const { stats } = await import(DIR + "/shim.mjs");
const { prisma } = await import("@/lib/prisma");
const { kolayikMonth } = await import("@/server/services/kolayik/payroll-sync");
const month = await kolayikMonth(prisma, 2026, 9);
writeFileSync(DIR + "/month_sep_pending.json", JSON.stringify(month, null, 1));
console.log(`okuma ${month.fetched_at} · ${stats.calls} çağrı · ok=${month.ok} · uyarı=${JSON.stringify(month.warnings)} · hata=${month.error ?? "-"}`);
const period = await prisma.payrollPeriod.findUniqueOrThrow({ where: { year_month: { year: 2026, month: 9 } } });
const lines = await prisma.payrollLine.findMany({ where: { period_id: period.id }, include: { employee: { select: { id: true, full_name: true, position: true } }, store: { select: { name: true } } } });
const byEmp = new Map(lines.map((l) => [l.employee_id, l]));
const info = (employee_id: string | null, name: string) => {
  const l = employee_id ? byEmp.get(employee_id) : null;
  return { name, store: l?.store.name ?? "?", position: l?.employee.position ?? "?" };
};
const dm = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
const isSun = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).getUTCDay() === 0;
console.log("\n=== ONAY BEKLEYEN MESAİ KAYITLARI (Eylül) ===");
let n = 0, h = 0;
for (const o of month.overtime) {
  const w = o.entries.filter((e: any) => e.status === "waiting");
  if (!w.length) continue;
  const i = info(o.employee_id, o.person_name);
  console.log(`${i.store} | ${i.name} | ${i.position}`);
  for (const e of w) {
    n++; h += e.hours;
    console.log(`    ${dm(e.date)}${isSun(e.date) ? " PAZAR" : ""} · ${e.hours} s · hak günü=${e.credit_day ? "evet" : "hayır"} · ücretli ${e.paid_hours} s${e.rest_day && !e.credit_day ? " (pazar, yalnız ek saat)" : ""} · "${(e.description ?? "").replace(/\s+/g, " ").slice(0, 110)}"`);
  }
}
console.log(`toplam bekleyen mesai: ${n} kayıt · ${h} saat`);
console.log("\n=== ONAY BEKLEYEN İZİN KAYITLARI (Eylül'e değen) ===");
let ln = 0;
for (const l of month.leaves) {
  const w = l.entries.filter((e: any) => e.status === "waiting");
  if (!w.length) continue;
  const i = info(l.employee_id, l.person_name);
  console.log(`${i.store} | ${i.name} | ${i.position}`);
  for (const e of w) { ln++; console.log(`    ${e.type} ${dm(e.start)}${e.end !== e.start ? "–" + dm(e.end) : ""} · ${e.days} gün · "${(e.comment ?? "").replace(/\s+/g, " ").slice(0, 110)}"`); }
}
console.log(`toplam bekleyen izin: ${ln} kayıt`);
const st: Record<string, number> = {};
for (const o of month.overtime) for (const e of o.entries) st[`mesai/${e.status}`] = (st[`mesai/${e.status}`] ?? 0) + 1;
for (const l of month.leaves) for (const e of l.entries) st[`izin/${e.status}`] = (st[`izin/${e.status}`] ?? 0) + 1;
console.log("\ndurum dağılımı:", JSON.stringify(st));
console.log("müdür görevleri:", [...new Set(lines.map((l) => l.employee.position))].join(" | "));
await prisma.$disconnect();
