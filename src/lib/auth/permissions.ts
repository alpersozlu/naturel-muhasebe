import "server-only";
import { TRPCError } from "@trpc/server";
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

/** Throw if user cannot access given store. */
export async function assertCanAccessStore(
  user: SessionUser,
  storeId: string
): Promise<void> {
  const ok = await canAccessStore(user, storeId);
  if (!ok) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Bu mağazaya erişim yetkin yok",
    });
  }
}

/** Kullanıcı bu markanın HERHANGİ bir mağazasına erişebiliyor mu? */
export async function canAccessBrand(
  user: SessionUser,
  brandId: string
): Promise<boolean> {
  if (isAdmin(user)) return true;

  const access = await prisma.userStoreAccess.findFirst({
    where: {
      user_id: user.id,
      store: { brand_id: brandId, deleted_at: null },
    },
    select: { user_id: true },
  });
  return !!access;
}

export async function assertCanAccessBrand(
  user: SessionUser,
  brandId: string
): Promise<void> {
  const ok = await canAccessBrand(user, brandId);
  if (!ok) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Bu markaya erişim yetkin yok",
    });
  }
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
    where: { user_id: user.id, store: { deleted_at: null } },
    select: { store_id: true },
  });
  return access.map((a) => a.store_id);
}

/** Erişebileceği tüm marka ID'leri (admin → tüm markalar). */
export async function getAccessibleBrandIds(user: SessionUser): Promise<string[]> {
  if (isAdmin(user)) {
    const brands = await prisma.brand.findMany({
      where: { deleted_at: null },
      select: { id: true },
    });
    return brands.map((b) => b.id);
  }
  const access = await prisma.userStoreAccess.findMany({
    where: { user_id: user.id, store: { deleted_at: null } },
    select: { store: { select: { brand_id: true } } },
  });
  const ids = new Set(access.map((a) => a.store.brand_id));
  return Array.from(ids);
}

export function requireRole(user: SessionUser, ...allowed: UserRole[]): void {
  if (!allowed.includes(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}
