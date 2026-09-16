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
          <div className="text-foreground font-medium">Takıldığınız bir şey olursa yöneticinize yazın</div>
          <div className="mt-2 text-sm">
            Alp Ersözlü — <a className="underline underline-offset-2" href="mailto:alpersozlu1@gmail.com">alpersozlu1@gmail.com</a>
          </div>
          <div className="mt-1 text-sm">WhatsApp üzerinden de ulaşabilirsiniz.</div>
          <div className="mt-4 text-xs leading-relaxed max-w-md mx-auto">
            Bir belge okunamadıysa önce satırdaki &quot;Yeniden analiz et&quot; düğmesini deneyin; sürerse
            fotoğrafı dik, yakından ve gölgesiz çekip tekrar yükleyin.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
