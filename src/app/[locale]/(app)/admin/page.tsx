import { Users, Activity } from "lucide-react";
import { Link } from "@/i18n/navigation";
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

      <div className="flex items-center gap-4 mb-6 text-sm">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"
        >
          <Users className="h-4 w-4" />
          Kullanıcıları yönet
        </Link>
        <Link
          href="/admin/audit"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"
        >
          <Activity className="h-4 w-4" />
          Aktivite günlüğü
        </Link>
      </div>

      <div className="mb-2">
        <h2 className="text-lg font-semibold">Markalar</h2>
      </div>
      <BrandList />
    </div>
  );
}
