// Fresh read of each person's leave balance (documented public endpoint, the same one the in-app audit uses)
// and comparison of the yearly "extra leave" total with the snapshot taken by the audit earlier today.
import { readFileSync } from "node:fs";
import { run, save } from "./pull.mjs";
const snap = JSON.parse(readFileSync(new URL("./audit_view_sep_v2.json", import.meta.url), "utf8"));
const people = snap.rows.map((r) => ({ id: r.person_id, name: r.name, store: r.store_name, before: r.balance, worked: r.counts.worked, with8: r.counts.with_8h }));
const results = await run(people.map((p) => ({ path: `/v2/person/leave-status/${p.id}`, method: "GET" })));
const out = [];
people.forEach((p, i) => {
  const r = results[i];
  if (!r.ok) { out.push({ ...p, error: r.error }); return; }
  const prim = (Array.isArray(r.data) ? r.data : []).find((t) => t.primary) ?? null;
  out.push({ ...p, now: prim ? { earned: prim.currentEarned ?? 0, bonus: prim.leaveBonus ?? 0, used: prim.currentUsed ?? prim.used ?? 0, unused: prim.unused ?? 0 } : null, keys: prim ? Object.keys(prim) : [] });
});
save("bonus_now.json", { read_at: new Date().toISOString(), snapshot_at: snap.fetched_at, rows: out });
console.log(`anlık okuma ${new Date().toISOString()} · önceki okuma ${snap.fetched_at}`);
console.log("alanlar:", out.find((o) => o.keys?.length)?.keys.join(", "));
for (const o of out) {
  if (o.error || !o.now) { console.log(`${o.name.padEnd(24)} OKUNAMADI ${o.error ?? ""}`); continue; }
  const d = (k) => Math.round((o.now[k] - (o.before?.[k] ?? 0)) * 100) / 100;
  const mark = d("bonus") !== 0 || d("used") !== 0 ? "  ◀ değişti" : "";
  console.log(`${o.name.padEnd(24)} ${o.store.padEnd(16)} pazar ${o.worked} (8s kayıtlı ${o.with8}) · ek izin ${String(o.before?.bonus).padStart(5)} → ${String(o.now.bonus).padStart(5)} (${d("bonus") >= 0 ? "+" : ""}${d("bonus")}) · kullanılan ${String(o.before?.used).padStart(4)} → ${String(o.now.used).padStart(4)} · kalan ${String(o.now.unused).padStart(5)}${mark}`);
}
