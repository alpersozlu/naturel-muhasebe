// READ-ONLY: every active person's annual-leave balance in Kolay İK; who used more than entitled; new starters.
import { writeFileSync, readFileSync } from "node:fs";
const DIR = process.env.KIK_DIR!;
const { stats } = await import(DIR + "/shim.mjs");
const { prisma } = await import("@/lib/prisma");
const { listPersons, leaveStatus, pooled } = await import("@/server/services/kolayik/client");
const { matchEmployee } = await import("@/server/services/kolayik/payroll-sync");
const month = JSON.parse(readFileSync(DIR + "/month_sep_mgr.json", "utf8"));
const persons = await listPersons("active");
const emps = await prisma.payrollEmployee.findMany({ include: { store: { select: { name: true } } } });
const sep = await prisma.payrollPeriod.findUniqueOrThrow({ where: { year_month: { year: 2026, month: 9 } } });
const lines = await prisma.payrollLine.findMany({ where: { period_id: sep.id }, select: { employee_id: true, store: { select: { name: true } } } });
const storeOf = new Map(lines.map((l) => [l.employee_id, l.store.name]));
const rows: any[] = [];
const statuses = await pooled(persons.map((p: any) => async () => ({ p, st: await leaveStatus(p.id).catch(() => null) })), 4);
for (const { p, st } of statuses) {
  const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  const prim = (st ?? []).find((t: any) => t.primary);
  const e = matchEmployee({ name }, emps.map((x) => ({ id: x.id, full_name: x.full_name, aliases: x.aliases ?? [], bank_account_name: x.bank_account_name, status: x.status })) as any);
  const emp = e ? emps.find((x) => x.id === e.id) : null;
  const waiting = (month.leaves.find((l: any) => l.person_name === name)?.entries ?? []).filter((x: any) => x.status === "waiting").reduce((s: number, x: any) => s + x.days, 0);
  const start = prim?.periods?.current?.start ?? null;
  rows.push({ name, store: emp ? storeOf.get(emp.id) ?? emp.store?.name ?? "?" : "?", position: emp?.position ?? "?", start, earned: prim?.currentEarned ?? null, bonus: prim?.leaveBonus ?? null, used: prim?.currentUsed ?? prim?.used ?? null, unused: prim?.unused ?? null, carried: prim?.carriedOver ?? 0, waiting, matched: !!emp });
}
writeFileSync(DIR + "/leave_balances_all.json", JSON.stringify({ read_at: new Date().toISOString(), rows }, null, 1));
console.log(`okuma ${new Date().toISOString()} · ${stats.calls} çağrı · ${rows.length} kişi`);
// accrued to date: 14 × months (start month .. October, partial months count) ÷ 12, only for periods starting in 2026
const accrued = (start: string | null) => {
  if (!start) return null;
  const [y, m] = start.split("-").map(Number);
  if (y < 2026) return 14 * 10 / 12;
  const months = 10 - m + 1;
  return Math.round((14 * months / 12) * 100) / 100;
};
rows.sort((a, b) => (a.unused ?? 0) - (b.unused ?? 0));
console.log("\n=== HAKKINDAN FAZLA KULLANANLAR (Kolay İK kalan < 0) ve bekleyen izinle eksiye düşecekler ===");
for (const r of rows) {
  const after = (r.unused ?? 0) - r.waiting;
  if ((r.unused ?? 0) < 0 || after < 0) console.log(`${r.name.padEnd(24)} ${String(r.store).padEnd(16)} ${String(r.position).padEnd(16)} başl. ${r.start} · hak ${r.earned} + ek ${r.bonus} + devir ${r.carried} · kullanılan ${r.used} · kalan ${r.unused}${r.waiting ? ` · bekleyen ${r.waiting} gün → ${after}` : ""}`);
}
console.log("\n=== 2026'DA BAŞLAYANLAR (yeni personel) — bugüne kadar aylık hak edişe göre ===");
for (const r of rows.filter((x) => x.start && x.start >= "2026-01-02").sort((a, b) => a.start.localeCompare(b.start))) {
  const acc = accrued(r.start)!;
  const left = Math.round((acc + (r.bonus ?? 0) - (r.used ?? 0)) * 100) / 100;
  console.log(`${r.name.padEnd(24)} ${String(r.store).padEnd(16)} ${String(r.position).padEnd(16)} başl. ${r.start} · Kolay İK: hak ${r.earned} + ek ${r.bonus}, kullanılan ${r.used}, kalan ${r.unused} · bugüne kadar hak ediş ${acc} → aylık hesapla kalan ${left}${r.waiting ? ` · bekleyen ${r.waiting}` : ""}`);
}
console.log("\neşleşmeyen:", rows.filter((r) => !r.matched).map((r) => r.name).join(", ") || "yok");
await prisma.$disconnect();
