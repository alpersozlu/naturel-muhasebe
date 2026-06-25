import { ChevronLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { UserList } from "@/components/admin/user-list";
import { UserCreateForm } from "@/components/admin/user-create-form";

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

      <PageHeader
        title="Kullanıcı Yönetimi"
        description="Admin, mağaza müdürü, kasiyer ve satış temsilcilerini yönet."
      />

      <section className="mt-6">
        <h2 className="text-base font-semibold mb-3">Tüm Kullanıcılar</h2>
        <UserList />
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold mb-3">Yeni Kullanıcı Ekle</h2>
        <UserCreateForm />
      </section>
    </div>
  );
}
