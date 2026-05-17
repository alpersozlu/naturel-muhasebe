import "server-only";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "./session";
import type { UserRole } from "@prisma/client";

export function isAdmin(user: SessionUser): boolean {
  return user.role === "admin";
}

/** Bir kullanıcının verilen mağazaya erişim yetkisi var mı? */
export async function canAccessStore(
  user: SessionUser,
  storeId: string
): Promise<boolean> {
  if (isAdmin(user)) return true;

  const access = await prisma.userStoreAccess.findUnique({
    where: { user_id_store_id: { user_id: user.id, store_id: storeId } },
  });
  return !!access;
}

/** Erişebileceği tüm mağaza ID'leri (admin → tüm mağazalar). */
export async function getAccessibleStoreIds(user: SessionUser): Promise<string[]> {
  if (isAdmin(user)) {
    const stores = await prisma.store.findMany({
      where: { deleted_at: null },
      select: { id: true },
    });
    return stores.map((s) => s.id);
  }
  const access = await prisma.userStoreAccess.findMany({
    where: { user_id: user.id },
    select: { store_id: true },
  });
  return access.map((a) => a.store_id);
}

export function requireRole(user: SessionUser, ...allowed: UserRole[]): void {
  if (!allowed.includes(user.role)) {
    throw new Error("FORBIDDEN");
  }
}
