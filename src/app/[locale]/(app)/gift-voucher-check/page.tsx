import { PageHeader } from "@/components/shared/page-header";
import { GiftVoucherCheck } from "@/components/gift-voucher/gift-voucher-check";

export default function GiftVoucherCheckPage() {
  return (
    <div>
      <PageHeader
        title="Hediye Çeki Kontrolü"
        description="Mavi'den kazanılan çeklerin doğru alışverişe verilip verilmediğini denetler: çeki ve Mavi fişini okut, kademe, süre ve mükerrer kullanım kendiliğinden kontrol edilsin."
      />
      <GiftVoucherCheck />
    </div>
  );
}
