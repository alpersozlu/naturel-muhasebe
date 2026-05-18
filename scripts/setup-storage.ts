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

const BUCKET = "uploads";
const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];

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
  const { data: list, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw listErr;

  const exists = list?.some((b) => b.name === BUCKET);
  if (exists) {
    console.log(`   ↳ zaten var`);
  } else {
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ALLOWED_MIME,
    });
    if (error) throw new Error(`Bucket oluşturulamadı: ${error.message}`);
    console.log(`   ↳ oluşturuldu (private, max 10 MB, image/* + pdf)`);
  }

  console.log("\n✅ Storage hazır.");
  console.log(
    "\nSonraki adım — RLS policies'i Supabase Dashboard SQL Editor'de çalıştır:"
  );
  console.log(
    "   https://supabase.com/dashboard/project/cnasyjbcnratrkoxokqk/sql/new"
  );
  console.log(
    "   SQL dosyası: supabase/migrations/20260518_storage_policies.sql"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
