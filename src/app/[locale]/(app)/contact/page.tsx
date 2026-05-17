import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Mail } from "lucide-react";

export default function ContactPage() {
  return (
    <div>
      <PageHeader
        title="Bize Ulaşın"
        description="Soru ve önerileriniz için bize yazın."
      />
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Mail className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div>İletişim formu yakında.</div>
        </CardContent>
      </Card>
    </div>
  );
}
