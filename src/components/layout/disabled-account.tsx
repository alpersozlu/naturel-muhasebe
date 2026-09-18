"use client";

import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Shown when Supabase still has a session but the app does not recognise
 * the account (disabled or removed). Without this the shell rendered with
 * no menu and every request failed.
 */
export function DisabledAccount() {
  const signOut = async () => {
    await createClient().auth.signOut({ scope: "local" });
    window.location.assign("/tr/login");
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 space-y-4">
          <div className="font-semibold">Hesabınız devre dışı</div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Bu hesap kapatılmış ya da kaldırılmış. Yeniden açılması için yöneticinize yazın.
          </p>
          <Button variant="outline" className="w-full" onClick={signOut}>
            Çıkış yap
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
