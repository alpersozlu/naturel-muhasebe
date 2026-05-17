import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, Receipt, FileText, Banknote, Wallet, Building } from "lucide-react";

const CARDS = [
  { icon: Building, label: "Banka Dekontu", color: "bg-blue-50 text-blue-600" },
  { icon: Receipt, label: "POS Fişi", color: "bg-purple-50 text-purple-600" },
  { icon: FileText, label: "Mağaza Özeti", color: "bg-amber-50 text-amber-600" },
  { icon: Banknote, label: "Peşin Ödeme", color: "bg-emerald-50 text-emerald-600" },
  { icon: Wallet, label: "Masraf/Fatura", color: "bg-rose-50 text-rose-600" },
];

export default function UploadPage() {
  return (
    <div>
      <PageHeader
        title="Yükle ve Analiz Et"
        description="Marka, mağaza ve gün seçimi yaparak gün sonu belgelerini yükleyin."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CARDS.map(({ icon: Icon, label, color }) => (
          <Card key={label} className="hover:border-primary/50 transition-colors">
            <CardContent className="p-6">
              <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${color} mb-3`}>
                <Icon className="h-6 w-6" />
              </div>
              <div className="font-medium">{label}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Yüklemeler Devre Dışı Bırakıldı
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 text-center">
        <Upload className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
        <div className="text-xs italic text-muted-foreground">
          Bu sayfanın aktif yükleme akışı Aşama 4'te eklenecek.
        </div>
      </div>
    </div>
  );
}
