// A Mavi store's month-end files through the app's own procedures (the ones the drop zone calls):
// upload each file → cross-check → apply when clean. STORE = name fragment, FILES = paths separated by "|".
import { readFileSync } from "node:fs";
const { prisma } = await import("@/lib/prisma");
const { appRouter } = await import("@/server/trpc/routers/_app");
const { loadPeriodView } = await import("@/server/services/payroll/period");
const tl = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v));
const admin = await prisma.user.findFirst({ where: { role: "admin", is_active: true, deleted_at: null, email: process.env.OWNER_EMAIL } });
if (!admin) throw new Error("yönetici kullanıcı bulunamadı");
const caller = appRouter.createCaller({ user: { ...admin, authUserId: admin.id, email: admin.email }, prisma } as any);
const period = await prisma.payrollPeriod.findUniqueOrThrow({ where: { year_month: { year: 2026, month: 9 } } });
const store = await prisma.store.findFirstOrThrow({ where: { deleted_at: null, name: { contains: process.env.STORE!, mode: "insensitive" }, brand: { name: { contains: "mavi", mode: "insensitive" } } } });
console.log("mağaza:", store.name);
for (const f of process.env.FILES!.split("|")) {
  const r = await caller.payroll.performance.upload({ period_id: period.id, store_id: store.id, file_name: f.split("/").pop()!, file_base64: readFileSync(f).toString("base64") });
  console.log(`yüklendi: ${f.split("/").pop()} → ${r.kind} · SAP özgün=${r.genuine}`);
}
const perf = (await caller.payroll.performance.get({ period_id: period.id })).find((x) => x.store_id === store.id)!;
const c = perf.check!;
const bad = c.flags.some((f) => f.level === "error") || c.rows.some((r) => r.flags.some((f) => f.level === "error"));
console.log(`çapraz kontrol: belgeler ${perf.docs.map((d) => d.kind).join(", ")} · hazır=${c.ready} hata=${bad} · mağaza net ${tl(c.store_net)} (${c.store_net_source}) · kişi toplamı ${tl(c.persons_sum)} · günlükle tutuyor=${c.daily_agrees} · top-seller ${c.top_seller}`);
for (const f of c.flags) console.log(`  [${f.level}] ${f.text}`);
for (const r of c.rows) for (const f of r.flags.filter((x) => x.level !== "info")) console.log(`  ${r.name}: [${f.level}] ${f.text}`);
if (!c.ready || bad) { console.log("AKTARILMADI — kontrol temiz değil."); await prisma.$disconnect(); process.exit(1); }
const res = await caller.payroll.performance.applyToLines({ period_id: period.id, store_id: store.id, force: false });
console.log(`AKTARIM: ${res.updated} satır güncellendi, ${res.unchanged} satır zaten aynıydı · mağaza cirosu ${tl(res.store_net)} · top-seller ${res.top_seller}`);
const v = (await loadPeriodView(prisma, period.id))!;
const sb = v.stores.find((s) => s.store_id === store.id)!;
console.log(`\n${sb.store_name}: ciro ${tl(sb.revenue)} · hedef ${tl(sb.target)} · başarı ${sb.achievement != null ? (sb.achievement * 100).toFixed(2) + "%" : "—"}`);
for (const l of sb.lines.filter((x) => x.employee_status !== "inactive")) {
  const k = l.calc;
  console.log(`  ${l.full_name.padEnd(22)} ${l.position.padEnd(15)} ${l.commission_profile.padEnd(12)} ND ${tl(l.own_revenue_nd).padStart(12)} · denim ${tl(l.own_revenue_denim).padStart(11)} · hedef ${tl(l.own_target).padStart(12)} · top ${l.top_seller ? "evet" : "—"} · komisyon ${tl(k.commission.final).padStart(9)} · mesai ${tl(k.overtime_amount).padStart(8)} · Ödeme 2 ${tl(k.payment2_due).padStart(10)}`);
  for (const f of k.flags.filter((x) => x.level !== "info")) console.log(`       [${f.level}] ${f.text}`);
}
await prisma.$disconnect();
