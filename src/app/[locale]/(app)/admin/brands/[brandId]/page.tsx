import { notFound } from "next/navigation";
import { ChevronLeft, Building2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { StoreList } from "@/components/admin/store-list";
import { CreateStoreButton } from "@/components/admin/store-form-dialog";

export default async function BrandDetailPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand || brand.deleted_at) notFound();

  return (
    <div>
      <Link
        href="/admin"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        Yönetici Portalı
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{brand.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Mağazaları yönet, çalışan ata, gün sonu yüklemelerini gör.
            </p>
          </div>
        </div>
        <CreateStoreButton brandId={brand.id} />
      </div>

      <div className="mb-2">
        <h2 className="text-lg font-semibold">Mağazalar</h2>
      </div>
      <StoreList brandId={brand.id} />
    </div>
  );
}
