import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays } from "lucide-react";

export default function VerificationPage() {
  return (
    <div>
      <PageHeader
        title="Doğrulama Sistemi"
        description="Mağazalar genelindeki günlük doğrulama durumunu takip edin."
      />
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <CalendarDays className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div>Bu seçim için veri bulunmamaktadır.</div>
          <div className="text-xs mt-4 italic">Bu sayfa Aşama 5'te aktif olacak.</div>
        </CardContent>
      </Card>
    </div>
  );
}
