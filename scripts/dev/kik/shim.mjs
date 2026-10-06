// Local test helper: forwards every Kolay İK request of the REAL server code through the
// signed, read-only endpoint (the Kolay İK key lives only on Vercel). The signing key is read
// from the environment and never sent — only the signature goes out.
import { createHmac } from "node:crypto";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY yok");
process.env.KOLAYIK_API_TOKEN ||= "forwarded-through-signed-endpoint";
const ENDPOINT = "https://naturel-muhasebe-7emg.vercel.app/api/jobs/kolayik";
const realFetch = globalThis.fetch;
export const stats = { calls: 0, r429: 0 };
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== "api.kolayik.com") return realFetch(input, init);
  stats.calls += 1;
  const query = {};
  url.searchParams.forEach((v, k) => (query[k] = v));
  let form;
  if (init?.body instanceof FormData) { form = {}; init.body.forEach((v, k) => (form[k] = String(v))); }
  const body = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 120, calls: [{ path: url.pathname, method: init?.method ?? "GET", query, form }] });
  const sig = createHmac("sha256", KEY).update(body).digest("hex");
  const res = await realFetch(ENDPOINT, { method: "POST", body, headers: { "x-signature": sig, "content-type": "application/json" } });
  const j = await res.json();
  const r = j.results?.[0];
  if (res.status !== 200 || !r) return new Response(JSON.stringify({ error: true, message: `uç HTTP ${res.status}` }), { status: 502 });
  if (!r.ok) { if (r.status === 429) stats.r429 += 1; return new Response(JSON.stringify({ error: true, message: r.error }), { status: r.status ?? 500 }); }
  return new Response(JSON.stringify({ error: false, data: r.data }), { status: 200 });
};
