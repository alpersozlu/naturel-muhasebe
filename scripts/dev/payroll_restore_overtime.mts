// REAL CHANGE (owner, 05.10.2026: "yanlışlıkla sıfırladım"): put the overtime hours and note of two people back to
// what they were before the accidental save. Only these two fields; everything else on the line stays.
// Written through the app's own audited procedure. MODE=dry shows what would be written.
const MODE = process.env.MODE ?? "dry";
const { prisma } = await import("@/lib/prisma");
const { appRouter } = await import("@/server/trpc/routers/_app");
const { loadPeriodView } = await import("@/server/services/payroll/period");
const tl = (v: number) => new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const admin = await prisma.user.findFirst({ where: { role: "admin", is_active: true, deleted_at: null, email: process.env.OWNER_EMAIL } });
if (!admin) throw new Error("yönetici kullanıcı bulunamadı");
const caller = appRouter.createCaller({ user: { ...admin, authUserId: admin.id, email: admin.email }, prisma } as any);
const period = await prisma.payrollPeriod.findUniqueOrThrow({ where: { year_month: { year: 2026, month: 9 } } });
const lines = await prisma.payrollLine.findMany({ where: { period_id: period.id, employee: { full_name: { in: ["Kaan Han Kılıç", "Oguzhan Özçetin"] } } }, include: { employee: { select: { full_name: true } } } });
if (lines.length !== 2) throw new Error("iki satır bekleniyordu, bulunan: " + lines.length);
for (const l of lines) {
  const logs = await prisma.auditLog.findMany({ where: { entity_id: l.id, entity_type: "PayrollLine" }, orderBy: { created_at: "asc" } });
  // the last save that still had hours > 0 = the state before the accident
  const good = [...logs].reverse().find((a) => Number((a.after_json as any)?.overtime_hours) > 0);
  const bad = logs[logs.length - 1];
  if (!good) throw new Error(l.employee.full_name + ": önceki dolu kayıt bulunamadı");
  const g = good.after_json as any;
  const nowH = Number(l.overtime_hours);
  console.log(`${l.employee.full_name}: şu an ${nowH} s · not "${(l.overtime_note ?? "").slice(0, 60)}…"`);
  console.log(`   kazadan önce (${good.created_at.toISOString()}): ${Number(g.overtime_hours)} s · not "${g.overtime_note}"`);
  console.log(`   son kayıt ${bad.created_at.toISOString()} · hedef şu an ${l.own_target ?? "-"} (dokunulmaz)`);
  if (nowH !== 0) { console.log("   ATLANDI: saat artık 0 değil — sahibi değiştirmiş olabilir."); continue; }
  if (MODE === "apply") {
    const r = await caller.payroll.lines.update({ id: l.id, overtime_hours: Number(g.overtime_hours), overtime_note: g.overtime_note });
    console.log(`   YAZILDI: ${Number(r.overtime_hours)} s · hedef ${r.own_target ?? "-"}`);
  }
}
const view = (await loadPeriodView(prisma, period.id))!;
for (const l of view.stores.flatMap((s) => s.lines).filter((x) => ["Kaan Han Kılıç", "Oguzhan Özçetin"].includes(x.full_name)))
  console.log(`${l.full_name}: mesai ${l.overtime_hours} s = ${tl(l.calc.overtime_amount)} · Ödeme 2 ${tl(l.calc.payment2_due)} · net kalan ${tl(l.calc.net_remaining)}`);
await prisma.$disconnect();
