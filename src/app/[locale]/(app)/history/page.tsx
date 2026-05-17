import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { History } from "lucide-react";

export default function HistoryPage() {
  return (
    <div>
      <PageHeader
        title="İşlem Geçmişi"
        description="Tüm yüklemeleri ve durumlarını görüntüleyin."
      />
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <History className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div>Henüz işlem geçmişi yok.</div>
          <div className="text-xs mt-4 italic">Bu sayfa Aşama 7'de aktif olacak.</div>
        </CardContent>
      </Card>
    </div>
  );
}
