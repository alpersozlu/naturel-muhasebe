// Mavi Güzelyurt 01–02.10 merge, through the app's own procedures, INSIDE A TRANSACTION THAT IS ROLLED BACK.
const { prisma } = await import("@/lib/prisma");
const { appRouter } = await import("@/server/trpc/routers/_app");
const { assertPriorDaysLocked } = await import("@/server/services/daily-record");
const { incompleteNotice, summaryCheck } = await import("@/components/upload/merge-wording");
const fmt = (iso: string) => iso.split("-").reverse().join(".");
const admin = await prisma.user.findFirst({ where: { role: "admin", is_active: true, deleted_at: null, email: process.env.OWNER_EMAIL } });
if (!admin) throw new Error("yönetici kullanıcı bulunamadı");
const store = await prisma.store.findFirstOrThrow({ where: { deleted_at: null, name: { contains: "zelyurt", mode: "insensitive" }, brand: { name: { contains: "mavi", mode: "insensitive" } } } });
const counts = async () => ({ groups: await prisma.dayMergeGroup.count(), days: await prisma.dailyRecord.count(), merged: await prisma.dailyRecord.count({ where: { merge_group_id: { not: null } } }), audit: await prisma.auditLog.count(), uploads: await prisma.upload.count() });
const before = await counts();
const ROLLBACK = new Error("ROLLBACK");
const show = (label: string, r: any) => {
  const missing: string[] = [];
  if (!r.has_z) missing.push("Z Raporu veya El Faturası");
  if (r.pos_count === 0) missing.push("POS Fişi");
  const sc = summaryCheck(r.merge, r.has_summary, fmt);
  const n = r.status === "incomplete" ? incompleteNotice({ merge: r.merge, has_summary: r.has_summary, missing, fmt }) : null;
  console.log(`${label}: durum=${r.status} · Z=${r.has_z} · POS=${r.pos_count} · özet=${r.has_summary} · birleşme=${r.merge ? `${r.merge.start_date}→${r.merge.end_date} gün#${r.merge.this_index} son=${r.merge.is_last_day}` : "yok"}`);
  console.log(`   kontrol satırı: "${sc.label}"${sc.waived ? " [istenmiyor]" : ""}`);
  if (n) console.log(`   bildirim (${n.tone}): ${n.title} — ${n.message}`);
};
try {
  await prisma.$transaction(
    async (tx) => {
      const txLike: any = new Proxy(tx, { get: (t: any, p) => (p === "$transaction" ? (fn: any) => fn(t) : t[p]) });
      const caller = appRouter.createCaller({ user: { ...admin, authUserId: admin.id, email: admin.email }, prisma: txLike } as any);
      console.log("— BİRLEŞME ÖNCESİ —");
      show("01.10", await caller.dailyRecord.reconciliation({ store_id: store.id, date: "2026-10-01" }));
      for (const [d, p] of [["2026-10-02", "2026-10-01"]] as const) {
        const pr = await caller.mergeGroup.probe({ store_id: store.id, date: d, prev_date: p });
        console.log(`probe ${p} → ${d}:`, JSON.stringify(pr));
      }
      const g = await caller.mergeGroup.create({ store_id: store.id, start_date: "2026-10-01", end_date: "2026-10-02" });
      console.log("grup kuruldu:", g.start_date.toISOString().slice(0, 10), "→", g.end_date.toISOString().slice(0, 10));
      console.log("— BİRLEŞME SONRASI —");
      show("01.10", await caller.dailyRecord.reconciliation({ store_id: store.id, date: "2026-10-01" }));
      show("02.10", await caller.dailyRecord.reconciliation({ store_id: store.id, date: "2026-10-02" }));
      const open = await caller.mergeGroup.getOpenForStore({ store_id: store.id });
      console.log("sayfadaki turuncu şerit:", open ? `${open.start_date.toISOString().slice(0, 10)} → ${open.end_date.toISOString().slice(0, 10)} (${open.daily_records.length} gün)` : "yok");
      // the store's own user: may it enter records on 02.10 and on 03.10?
      for (const d of ["2026-10-02", "2026-10-03"]) {
        try { await assertPriorDaysLocked(txLike, { role: "manager" }, store.id, d); console.log(`mağaza kullanıcısı ${fmt(d)} gününe kayıt girebilir`); }
        catch (e: any) { console.log(`mağaza kullanıcısı ${fmt(d)}: ENGEL — ${e.message}`); }
      }
      throw ROLLBACK;
    },
    { timeout: 120_000, maxWait: 20_000 }
  );
} catch (e) {
  if (e !== ROLLBACK) throw e;
  console.log("işlem geri alındı");
}
// without the merge: what does the gate say to the store today?
for (const d of ["2026-10-02"]) {
  try { await assertPriorDaysLocked(prisma, { role: "manager" }, store.id, d); console.log(`(bugünkü durum) mağaza ${fmt(d)} gününe kayıt girebilir`); }
  catch (e: any) { console.log(`(bugünkü durum) mağaza ${fmt(d)}: ENGEL — ${e.message}`); }
}
const after = await counts();
console.log("veritabanı değişmedi:", JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after));
await prisma.$disconnect();
