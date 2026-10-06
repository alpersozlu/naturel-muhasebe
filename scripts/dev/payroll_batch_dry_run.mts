// Store-by-store recording of the Ödeme 2 cash list on real September data, through the app's own
// procedures, INSIDE ONE TRANSACTION THAT IS ROLLED BACK (audit rows included). Nothing persists.
const { prisma } = await import("@/lib/prisma");
const { appRouter } = await import("@/server/trpc/routers/_app");
const { loadPeriodView } = await import("@/server/services/payroll/period");
const tl = (v: number) => new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const admin = await prisma.user.findFirst({ where: { role: "admin", is_active: true, deleted_at: null, email: process.env.OWNER_EMAIL } });
if (!admin) throw new Error("yönetici kullanıcı bulunamadı");
const period = await prisma.payrollPeriod.findUniqueOrThrow({ where: { year_month: { year: 2026, month: 9 } } });
const counts = async () => ({ entries: await prisma.payrollEntry.count(), batches: await prisma.payrollBatch.count(), audit: await prisma.auditLog.count(), lines: await prisma.payrollLine.count() });
const before = await counts();
const ROLLBACK = new Error("ROLLBACK");
try {
  await prisma.$transaction(
    async (tx) => {
      // procedures that open their own transaction run inside this one
      const txLike: any = new Proxy(tx, { get: (t: any, p) => (p === "$transaction" ? (fn: any) => fn(t) : t[p]) });
      const caller = appRouter.createCaller({ user: { ...admin, authUserId: admin.id, email: admin.email }, prisma: txLike } as any);
      const p0 = await caller.payroll.batches.prepare({ period_id: period.id, kind: "payment2", channel: "cash" });
      const stores = Array.from(new Set(p0.rows.map((r) => r.store_name)));
      console.log(`başlangıç: ${p0.rows.length} kişi · ${tl(p0.rows.reduce((s, r) => s + r.due, 0))} · mağazalar: ${stores.join(", ")} · uyarılı: ${p0.rows.filter((r) => r.pending_note).length}`);
      let left = p0.rows;
      for (const store of ["Mavi Girne", "DERIMOD MAGUSA"]) {
        const items = left.filter((r) => r.store_name === store).map((r) => ({ line_id: r.line_id, amount: r.due }));
        const r = await caller.payroll.batches.create({ period_id: period.id, kind: "payment2", channel: "cash", pay_date: "2026-10-05", items, mark_sent: true });
        const view = (await loadPeriodView(txLike, period.id))!;
        const b = view.batches.find((x) => x.id === r.id)!;
        const full = await tx.payrollBatch.findUniqueOrThrow({ where: { id: r.id }, include: { entries: true } });
        const sb = view.stores.find((s) => s.store_name === store)!;
        const stillDue = sb.lines.filter((l) => l.calc.payment2_due > 0.005).length;
        console.log(`\n${store}: kayıt ${r.count} kişi · ${tl(r.total)} · dosya=${r.file_name ?? "yok"}`);
        console.log(`  liste satırı: durum=${b.status} kanal=${b.channel} tür=${b.kind} mağazalar=${JSON.stringify(b.stores)} kişi=${b.count} toplam=${tl(b.total)}`);
        console.log(`  başlık: ${full.title}`);
        console.log(`  kayıtlar: ${full.entries.length} adet · kategori=${[...new Set(full.entries.map((e) => e.category))]} kanal=${[...new Set(full.entries.map((e) => e.channel))]} ref=${[...new Set(full.entries.map((e) => e.reference))]}`);
        console.log(`  mağazada Ödeme 2'si kalan: ${stillDue} kişi · mağaza net kalan ${tl(sb.totals.remaining)}`);
        const p = await caller.payroll.batches.prepare({ period_id: period.id, kind: "payment2", channel: "cash" });
        console.log(`  sonraki liste: ${p.rows.length} kişi · ${tl(p.rows.reduce((s, x) => s + x.due, 0))} · bu mağazadan ${p.rows.filter((x) => x.store_name === store).length} kişi`);
        left = p.rows;
      }
      // every other store untouched
      const view = (await loadPeriodView(txLike, period.id))!;
      const others = view.stores.filter((s) => !["Mavi Girne", "DERIMOD MAGUSA"].includes(s.store_name)).map((s) => `${s.store_name} ${s.lines.filter((l) => l.calc.payment2_due > 0.005).length}`);
      console.log(`\ndiğer mağazalarda Ödeme 2'si bekleyen kişi: ${others.join(" · ")}`);
      console.log(`listeler (yeni → eski, ilk 3): ${view.batches.slice(0, 3).map((b) => `${b.kind}/${b.channel}/${b.status}/${b.stores.length === 1 ? b.stores[0] : b.stores.length + " mağaza"}`).join(" | ")}`);
      throw ROLLBACK;
    },
    { timeout: 120_000, maxWait: 20_000 }
  );
} catch (e) {
  if (e !== ROLLBACK) throw e;
  console.log("\nişlem geri alındı");
}
const after = await counts();
console.log("veritabanı değişmedi (denetim kaydı dahil):", JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after));
await prisma.$disconnect();
