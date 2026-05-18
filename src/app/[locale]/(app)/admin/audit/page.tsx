import { ChevronLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { AuditList } from "@/components/admin/audit-list";

export default function AuditPage() {
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
        title="Aktivite Günlüğü"
        description="Tüm yönetici aksiyonları kayıt altına alınır."
      />

      <AuditList />
    </div>
  );
}
