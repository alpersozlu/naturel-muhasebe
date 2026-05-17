import { getSession, type SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export async function createContext() {
  let user: SessionUser | null = null;
  try {
    user = await getSession();
  } catch {
    user = null;
  }
  return { user, prisma };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
