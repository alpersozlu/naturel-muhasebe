"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { NrLogo } from "@/components/brand/nr-logo";

export default function LoginPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  // The invitation e-mail links here with ?email=…, so the person only
  // types the password.
  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get("email");
    if (preset) setEmail(preset);
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const code = (error as { code?: string }).code ?? "";
        const msg = error.message ?? "";
        if (code === "user_banned" || /banned/i.test(msg)) {
          toast.error("Hesabınız devre dışı bırakılmış — yöneticinize başvurun.");
        } else if (/fetch|network/i.test(msg)) {
          toast.error("Bağlantı hatası — internetinizi kontrol edip tekrar deneyin.");
        } else if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) {
          toast.error("E-posta veya şifre hatalı. Tarayıcı eski şifreyi doldurmuş olabilir; kutuyu temizleyip elle yazın.");
        } else if (code === "over_request_rate_limit" || /rate limit/i.test(msg)) {
          toast.error("Çok fazla deneme yapıldı — bir dakika bekleyip tekrar deneyin.");
        } else {
          // Anything else: say what Supabase said, so a real fault is not
          // read as a typo.
          toast.error(`Giriş yapılamadı: ${msg || t("invalidCredentials")}`);
        }
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  // "Şifremi unuttum": Supabase mails a recovery link that lands on
  // /reset-password with a code; that page sets the new password.
  const forgot = async () => {
    if (!email.trim()) {
      toast.error("Önce e-posta adresinizi yazın");
      return;
    }
    setResetting(true);
    try {
      const supabase = createClient();
      const locale = window.location.pathname.split("/")[1] || "tr";
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/${locale}/reset-password`,
      });
      if (error) {
        toast.error(`Bağlantı gönderilemedi: ${error.message}`);
        return;
      }
      toast.success("Şifre sıfırlama bağlantısı e-postanıza gönderildi. Bu tarayıcıda açın.");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-8">
          <div className="flex items-center gap-3 mb-6">
            <NrLogo className="h-10 w-10 shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold leading-tight">Naturel Ticaret Muhasebe</div>
              <div className="text-xs text-muted-foreground">{t("signIn")}</div>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t("email")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Giriş yapılıyor…" : t("signIn")}
            </Button>
            <button
              type="button"
              onClick={forgot}
              disabled={resetting}
              className="block w-full text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            >
              {resetting ? "Gönderiliyor…" : "Şifremi unuttum"}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
