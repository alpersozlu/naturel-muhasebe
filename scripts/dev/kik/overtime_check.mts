// READ-ONLY: fresh Kolay İK reading — for each store manager: approved / waiting September hours, what the
// "uygula" chip would write (= approved payable hours), and what the September payroll line holds now.
import { writeFileSync } from "node:fs";
const DIR = process.env.KIK_DIR!;
const { stats } = await import(DIR + "/shim.mjs");
const { prisma } = await import("@/lib/prisma");
const { kolayikMonth } = await import("@/server/services/kolayik/payroll-sync");
const tl = (v: number) => new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const hh = (v: number) => String(Math.round(v * 100) / 100).replace(".", ",");
const dm = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
const month = await kolayikMonth(prisma, 2026, 9);
if (!month.ok || month.warnings.length) throw new Error(`Kolay İK okuması eksik: ${month.error ?? ""} ${JSON.stringify(month.warnings)}`);
writeFileSync(DIR + "/month_sep_check.json", JSON.stringify(month, null, 1));
console.log(`Kolay İK okuması ${month.fetched_at} · ${stats.calls} çağrı`);
const period = await prisma.payrollPeriod.findUniqueOrThrow({ where: { year_month: { year: 2026, month: 9 } } });
const lines = await prisma.payrollLine.findMany({ where: { period_id: period.id }, include: { employee: { select: { full_name: true, position: true } }, store: { select: { name: true } } } });
const mgrs = lines.filter((l) => /müdür/i.test(l.employee.position));
for (const l of mgrs) {
  const o = month.overtime.find((x: any) => x.employee_id === l.employee_id);
  const rate = Number(l.base_salary) / 208;
  const inP = Number(l.overtime_hours);
  if (!o) { console.log(`${l.employee.full_name.padEnd(24)} ${l.store.name.padEnd(16)} ${l.employee.position.padEnd(16)} Kolay İK'da Eylül mesaisi yok · bordroda ${hh(inP)} s`); continue; }
  const appr = o.entries.filter((e: any) => e.status === "approved");
  const wait = o.entries.filter((e: any) => e.status === "waiting");
  console.log(`${l.employee.full_name.padEnd(24)} ${l.store.name.padEnd(16)} ${l.employee.position.padEnd(16)}`);
  console.log(`    Kolay İK onaylı ödenecek: ${hh(o.approved_hours)} s (${appr.map((e: any) => `${dm(e.date)} ${hh(e.paid_hours)}${e.credit_day ? " +hak günü" : ""}`).join(", ") || "yok"}) · hak günü ${o.credit_days}`);
  console.log(`    Kolay İK bekleyen:        ${hh(o.waiting_hours)} s (${wait.map((e: any) => `${dm(e.date)} ${hh(e.paid_hours)}`).join(", ") || "yok"})`);
  console.log(`    bordroda şu an:           ${hh(inP)} s = ${tl(inP * rate)} · not: ${(l.overtime_note ?? "").slice(0, 60)}`);
  console.log(`    "uygula" şu an yazar:     ${hh(o.approved_hours)} s = ${tl(o.approved_hours * rate)} ${Math.abs(o.approved_hours - inP) < 0.001 ? "(bordroyla aynı, düğme çıkmaz)" : o.approved_hours < inP ? "⚠ DÜŞÜRÜR" : "(artırır: önceden onaylı saatler de eklenir)"}`);
  console.log(`    bekleyenler onaylanınca "uygula" yazar: ${hh(o.approved_hours + o.waiting_hours)} s = ${tl((o.approved_hours + o.waiting_hours) * rate)}`);
}
await prisma.$disconnect();
