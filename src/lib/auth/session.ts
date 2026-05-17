import "server-only";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { User as DbUser } from "@prisma/client";

export type SessionUser = DbUser & {
  authUserId: string;
  email: string;
};

export async function getSession(): Promise<SessionUser | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return null;

  // DB'de bu kullanıcının kaydı var mı?
  const dbUser = await prisma.user.findUnique({ where: { email: user.email } });
  if (!dbUser) return null;

  return { ...dbUser, authUserId: user.id, email: user.email };
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    throw new Error("UNAUTHENTICATED");
  }
  return session;
}
