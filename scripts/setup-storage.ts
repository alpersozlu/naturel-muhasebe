/**
 * Set up Supabase Storage for DocuFlow:
 *   - Create `uploads` bucket (private, 10 MB, image/* + pdf only)
 *
 * Storage RLS policies aren't applied here — Prisma's postgres role
 * lacks the storage-schema function permissions. Apply them once via
 * Supabase Dashboard SQL Editor (paste the contents of
 * supabase/migrations/20260518_storage_policies.sql).
 *
 * Run:
 *   node --env-file=.env.local --import tsx scripts/setup-storage.ts
 */

import { createClient } from "@supabase/supabase-js";
import { ACCEPTED_MIME_TYPES, MAX_UPLOAD_BYTES, UPLOAD_BUCKET } from "../src/lib/constants";

// Constants'tan oku — kaynak-of-truth tek yer
const BUCKET = UPLOAD_BUCKET;
const ALLOWED_MIME: string[] = [...ACCEPTED_MIME_TYPES];

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tanımlı değil. " +
        "node --env-file=.env.local ile çalıştır."
    );
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`📦 Bucket kontrolü: ${BUCKET}`);
  console.log(`   ↳ izinli MIME (${ALLOWED_MIME.length}): ${ALLOWED_MIME.join(", ")}`);

  const { data: list, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw listErr;

  const existing = list?.find((b) => b.name === BUCKET);
  if (existing) {
    console.log(`   ↳ var, MIME whitelist güncelleniyor`);
    const { error } = await supabase.storage.updateBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_UPLOAD_BYTES,
      allowedMimeTypes: ALLOWED_MIME,
    });
    if (error) throw new Error(`Bucket güncellenemedi: ${error.message}`);
    console.log(`   ✓ güncellendi`);
  } else {
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_UPLOAD_BYTES,
      allowedMimeTypes: ALLOWED_MIME,
    });
    if (error) throw new Error(`Bucket oluşturulamadı: ${error.message}`);
    console.log(`   ✓ oluşturuldu`);
  }

  console.log("\n✅ Storage hazır.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
