/**
 * Seed: admin kullanıcısı oluştur.
 *
 * 2 yere kayıt atar:
 *   1) Supabase Auth (auth.users) — email/password ile giriş için
 *   2) Prisma User tablosu — uygulama içi yetkilendirme için
 *
 * Çalıştırma:
 *   node --env-file=.env.local --import tsx prisma/seed.ts
 */

import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "alpersozlu1@gmail.com";
const ADMIN_PASSWORD = "DocuflowTR2026!";
const ADMIN_NAME = "Alp Ersözlü";

const prisma = new PrismaClient();

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY tanımlı değil. " +
        "node --env-file=.env.local ile çalıştır."
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`🔐 Supabase auth.users'da kullanıcı kontrol ediliyor: ${ADMIN_EMAIL}`);

  // Var mı diye bak
  const { data: existing } = await supabase.auth.admin.listUsers();
  const found = existing?.users.find((u) => u.email === ADMIN_EMAIL);

  let authUserId: string;
  if (found) {
    authUserId = found.id;
    console.log(`   ↳ zaten var, id: ${authUserId}`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: ADMIN_NAME },
    });
    if (error || !data?.user) {
      throw new Error(`Supabase user oluşturulamadı: ${error?.message}`);
    }
    authUserId = data.user.id;
    console.log(`   ↳ oluşturuldu, id: ${authUserId}`);
    console.log(`   ↳ şifre: ${ADMIN_PASSWORD}  ←  giriş yaparken kullan, sonra değiştir`);
  }

  console.log(`\n📝 Prisma User tablosunda kayıt upsert ediliyor`);
  const user = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: "admin", full_name: ADMIN_NAME },
    create: {
      id: authUserId, // auth.users.id ile aynı UUID
      email: ADMIN_EMAIL,
      full_name: ADMIN_NAME,
      role: "admin",
    },
  });
  console.log(`   ↳ ${user.email} (${user.role})\n`);

  console.log("✅ Seed tamamlandı.");
  console.log(`\nGirişe hazır: http://localhost:3000/tr/login`);
  console.log(`   Email:  ${ADMIN_EMAIL}`);
  console.log(`   Şifre:  ${ADMIN_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
