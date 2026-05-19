import { notFound } from "next/navigation";
import { ChevronLeft, Store as StoreIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { requireSession } from "@/lib/auth/session";
import { canAccessStore } from "@/lib/auth/permissions";
import { StoreCalendar } from "@/components/stores/store-calendar";

export default async function StoreCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { storeId } = await params;
  const { month } = await searchParams;

  const session = await requireSession();
  const ok = await canAccessStore(session, storeId);
  if (!ok) notFound();

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: { brand: true },
  });
  if (!store || store.deleted_at) notFound();

  const now = new Date();
  const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthParam = month && /^\d{4}-\d{2}$/.test(month) ? month : defaultMonth;
  const [yearStr, monthStr] = monthParam.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);

  return (
    <div>
      <Link
        href={`/admin/brands/${store.brand_id}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        {store.brand.name}
      </Link>

      <div className="flex items-start gap-4 mb-6 min-w-0">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 shrink-0">
          <StoreIcon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight truncate">
            {store.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {store.city ? `${store.city} · ` : ""}Aylık gün sonu takvimi
          </p>
        </div>
      </div>

      <StoreCalendar storeId={storeId} year={year} month={monthNum} />
    </div>
  );
}
