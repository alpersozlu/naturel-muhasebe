import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, Store, Users, Briefcase } from "lucide-react";

const STATS = [
  { icon: Building2, label: "Markalar", value: 0, color: "text-indigo-600" },
  { icon: Store, label: "Mağazalar", value: 0, color: "text-emerald-600" },
  { icon: Users, label: "Mağaza Müdürleri", value: 0, color: "text-amber-600" },
  { icon: Briefcase, label: "Satış Temsilcileri", value: 0, color: "text-teal-600" },
];

export default function AdminPage() {
  return (
    <div>
      <PageHeader
        title="Yönetici Portalı"
        description="Markalarınızı, mağazalarınızı ve çalışanlarınızı yönetin."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {STATS.map(({ icon: Icon, label, value, color }) => (
          <Card key={label}>
            <CardContent className="pt-6">
              <Icon className={`h-6 w-6 mb-3 ${color}`} />
              <div className="text-3xl font-bold">{value}</div>
              <div className="text-sm text-muted-foreground mt-1">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <Building2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">Henüz hiçbir marka yok.</div>
          <div className="text-sm mt-1">İşe başlamak için ilk markanızı oluşturun.</div>
          <div className="text-xs mt-4 italic">Bu sayfa Aşama 3'te aktif olacak.</div>
        </CardContent>
      </Card>
    </div>
  );
}
