import { PageHeader } from "@/components/shared/page-header";
import { AdminStats } from "@/components/admin/admin-stats";
import { BrandList } from "@/components/admin/brand-list";
import { CreateBrandButton } from "@/components/admin/brand-form-dialog";

export default function AdminPage() {
  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <PageHeader
          title="Yönetici Portalı"
          description="Markalarınızı, mağazalarınızı ve çalışanlarınızı yönetin."
        />
        <CreateBrandButton />
      </div>

      <AdminStats />

      <div className="mb-2">
        <h2 className="text-lg font-semibold">Markalar</h2>
      </div>
      <BrandList />
    </div>
  );
}
