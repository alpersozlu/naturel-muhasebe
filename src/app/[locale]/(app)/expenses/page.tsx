import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Wallet } from "lucide-react";

export default function ExpensesPage() {
  return (
    <div>
      <PageHeader
        title="Gider Analizi"
        description="Mağazalar genelindeki nakit harcama kalıplarını analiz edin."
      />
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <Wallet className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">Nakit Gider Yok</div>
          <div className="text-sm mt-1">
            Nakit giderler, "Yükle ve Analiz Et" seçeneğiyle girildikten sonra
            burada görünecektir.
          </div>
          <div className="text-xs mt-4 italic">Bu sayfa Aşama 6'da aktif olacak.</div>
        </CardContent>
      </Card>
    </div>
  );
}
