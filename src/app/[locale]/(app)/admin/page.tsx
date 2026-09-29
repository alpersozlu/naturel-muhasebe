import { PageHeader } from "@/components/shared/page-header";
import { AdminStats } from "@/components/admin/admin-stats";
import { UsersPanel } from "@/components/admin/users-panel";
import { OrgHierarchy } from "@/components/admin/org-hierarchy";
import { CreateBrandButton } from "@/components/admin/brand-form-dialog";
import { BridgeFreshness } from "@/components/nebim-sales/bridge-freshness";

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

      <BridgeFreshness onlyWhenStale />

      <AdminStats />

      <UsersPanel />

      <div className="mb-2">
        <h2 className="text-lg font-semibold">Organizasyon Hiyerarşisi</h2>
      </div>
      <OrgHierarchy />
    </div>
  );
}
