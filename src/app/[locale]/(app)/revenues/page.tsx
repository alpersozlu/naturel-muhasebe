import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Banknote } from "lucide-react";

export default function RevenuesPage() {
  return (
    <div>
      <PageHeader
        title="Gelir Analizi"
        description="Mağazalar genelindeki nakit ve satış noktası gelir modellerini analiz edin."
      />
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <Banknote className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">Gelir Verisi Yok</div>
          <div className="text-sm mt-1">
            Mağaza özetleri "Yükle ve Analiz Et" seçeneğiyle yüklendikten sonra
            gelir rakamları burada görünecektir.
          </div>
          <div className="text-xs mt-4 italic">Bu sayfa Aşama 6'da aktif olacak.</div>
        </CardContent>
      </Card>
    </div>
  );
}
