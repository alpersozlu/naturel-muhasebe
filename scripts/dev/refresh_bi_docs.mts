// Re-read the stored BI report files so the records carry the newly read counts (sweatshirt, kids department).
// For each stored BI record: download its file, parse with the current reader, merge into the stored reading
// (a page the file does not contain is kept from the record). MODE=dry prints only.
const MODE = process.env.MODE ?? "dry";
const { prisma } = await import("@/lib/prisma");
const { createAdminClient } = await import("@/lib/supabase/admin");
const { UPLOAD_BUCKET } = await import("@/lib/constants");
const { parsePerformanceFile, mergeBiPdf, buildPerformanceCheck } = await import("@/server/services/payroll/performance");
const { loadMonthReps } = await import("@/server/services/dealer-report/daily-reps");
const docs = await prisma.payrollPerformanceDoc.findMany({ where: { kind: "bi_pdf" }, include: { store: { select: { id: true, name: true } }, period: true } });
const supa = createAdminClient();
for (const d of docs) {
  if (!d.file_path) { console.log(d.store.name, "— dosya yolu yok, atlandı"); continue; }
  const { data, error } = await supa.storage.from(UPLOAD_BUCKET).download(d.file_path);
  if (error || !data) { console.log(d.store.name, "indirilemedi:", error?.message); continue; }
  const fresh = (await parsePerformanceFile(d.file_name, Buffer.from(await data.arrayBuffer()))).parsed as any;
  if (fresh.kind !== "bi_pdf") { console.log(d.store.name, "beklenmeyen tür", fresh.kind); continue; }
  const old: any = d.parsed_json;
  const merged: any = mergeBiPdf(old, fresh);
  // the figures already on file must not change — only the new fields may appear
  const keys = ["net_tl", "upt", "sepet", "transactions", "denim_units", "units_total"];
  let changed = 0;
  for (const o of old.persons) { const n = merged.persons.find((x: any) => x.code === o.code); for (const k of keys) if ((o[k] ?? null) !== (n?.[k] ?? null)) { changed += 1; console.log(`   DEĞİŞTİ ${o.name} ${k}: ${o[k]} → ${n?.[k]}`); } }
  console.log(`${d.store.name} ${d.period.year}-${d.period.month}: kişi ${merged.persons.length} · değişen eski rakam ${changed} · yeni alanlar: ${merged.persons.map((p: any) => `${p.name.split(" ")[0]} sw ${p.sweatshirt_units ?? "—"}/ç ${p.cocuk_units ?? "—"}`).join(", ")}`);
  if (changed > 0) { console.log("   → yazılmadı (eski rakam değişiyor)"); continue; }
  if (MODE === "apply") await prisma.payrollPerformanceDoc.update({ where: { id: d.id }, data: { parsed_json: merged } });
  // the check as the screen will show it
  const all = await prisma.payrollPerformanceDoc.findMany({ where: { period_id: d.period_id, store_id: d.store_id } });
  const lines = await prisma.payrollLine.findMany({ where: { period_id: d.period_id, store_id: d.store_id }, include: { employee: true } });
  const daily = (await loadMonthReps(prisma, [d.store_id], d.period.year, d.period.month)).get(d.store_id) ?? null;
  const ref = (l: any) => ({ line_id: l.id, employee_id: l.employee_id, full_name: l.employee.full_name, aliases: l.employee.aliases, bank_account_name: l.employee.bank_account_name, commission_profile: l.commission_profile, own_revenue_nd: l.own_revenue_nd != null ? Number(l.own_revenue_nd) : null, own_revenue_denim: l.own_revenue_denim != null ? Number(l.own_revenue_denim) : null, top_seller: l.top_seller });
  const c = buildPerformanceCheck(all.map((x) => (x.id === d.id ? merged : (x.parsed_json as any))), lines.map(ref), daily);
  const notes = c.rows.flatMap((r) => r.flags.filter((f) => f.level !== "info").map((f) => `${r.name}: [${f.level}] ${f.text}`));
  console.log(`   kontrol: hazır=${c.ready} · bilgi dışı işaret ${notes.length + c.flags.filter((f) => f.level !== "info").length}${notes.length ? " → " + notes.join(" ; ") : ""}${c.flags.filter((f) => f.level !== "info").map((f) => ` · [${f.level}] ${f.text}`).join("")}`);
}
await prisma.$disconnect();
