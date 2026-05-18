import { ChevronLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { UserList } from "@/components/admin/user-list";
import { UserCreateDialog } from "@/components/admin/user-form-dialog";

export default function UsersPage() {
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
        <PageHeader
          title="Kullanıcılar"
          description="Admin, mağaza müdürü, kasiyer ve satış temsilcilerini yönet."
        />
        <UserCreateDialog />
      </div>

      <UserList />
    </div>
  );
}
