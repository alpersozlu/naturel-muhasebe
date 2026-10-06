// Signed, read-only pull from the Kolay İK audit endpoint. The signing key is
// read from the environment (never printed, never sent — only the signature).
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY yok");
const URL_ = "https://naturel-muhasebe-7emg.vercel.app/api/jobs/kolayik";
export async function run(calls) {
  const body = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 120, calls });
  const sig = createHmac("sha256", KEY).update(body).digest("hex");
  const res = await fetch(URL_, { method: "POST", body, headers: { "x-signature": sig, "content-type": "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).results;
}
export const save = (name, data) => writeFileSync(new URL(`./${name}`, import.meta.url), JSON.stringify(data, null, 1));
