"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Link } from "@/i18n/navigation";
import { ProfileSections } from "./person-card";
import { Notice } from "./staff-home";

/** "Bilgilerim" — personel kendi bilgilerini görür; telefon, adres, acil durum kişisini kendisi günceller. */
export function MyInfo() {
  const q = trpc.hr.profile.useQuery({});
  return (
    <div className="space-y-4">
      <Link href="/ik" className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Geri
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bilgilerim</h1>
        <p className="text-sm text-muted-foreground">
          Telefonunuzu, adresinizi ve acil durumda aranacak kişiyi kendiniz güncelleyebilirsiniz. Diğer bilgilerde yanlış varsa yöneticinize söyleyin.
        </p>
      </div>
      {q.isLoading ? (
        <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-muted-foreground" />
      ) : q.error || !q.data ? (
        <Notice tone="red" title="Açılamadı" text={q.error?.message ?? ""} />
      ) : (
        <ProfileSections data={q.data} />
      )}
    </div>
  );
}
