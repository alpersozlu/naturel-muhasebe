"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { NrLogo } from "@/components/brand/nr-logo";

export default function LoginPage() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [failed, setFailed] = useState(0);
  const forgotMut = trpc.auth.forgotPassword.useMutation();
  const noteFailed = trpc.auth.noteFailedLogin.useMutation();
  const noteLogin = trpc.auth.noteLogin.useMutation();
  // The invitation e-mail links here with ?email=…, so the person only
  // types the password.
  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get("email");
    if (preset) setEmail(preset);
    // An older recovery mail (Supabase redirect style) lands on the site
    // root with the tokens in the hash and is bounced here; the hash
    // survives the bounce. Hand it to the reset page instead of losing it.
    if (/type=recovery/.test(window.location.hash) && /access_token=/.test(window.location.hash)) {
      const locale = window.location.pathname.split("/")[1] === "en" ? "en" : "tr";
      window.location.replace(`/${locale}/reset-password${window.location.hash}`);
    }
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    let keepBusy = false; // stay on "Giriş yapılıyor…" while the browser navigates
    try {
      const supabase = createClient();
      const cleanEmail = email.trim().toLowerCase();
      const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (error) {
        const code = (error as { code?: string }).code ?? "";
        const msg = error.message ?? "";
        setFailed((n) => n + 1);
        // Support log: which address, which reason. Never the password.
        noteFailed.mutate({ email: cleanEmail, code: (code || msg).slice(0, 60) });
        if (code === "user_banned" || /banned/i.test(msg)) {
          toast.error("Hesabınız devre dışı bırakılmış — yöneticinize başvurun.");
        } else if (/fetch|network/i.test(msg)) {
          toast.error("Bağlantı hatası — internetinizi kontrol edip tekrar deneyin.");
        } else if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) {
          toast.error("E-posta veya şifre hatalı. Göz simgesiyle yazdığınız şifreyi kontrol edin.");
        } else if (code === "over_request_rate_limit" || /rate limit/i.test(msg)) {
          toast.error("Çok fazla deneme yapıldı — bir dakika bekleyip tekrar deneyin.");
        } else {
          // Anything else: say what Supabase said, so a real fault is not
          // read as a typo.
          toast.error(`Giriş yapılamadı: ${msg || t("invalidCredentials")}`);
        }
        return;
      }
      // Full page load to the person's own landing page. The old
      // router.refresh() went login → (middleware) /admin → (layout) /upload
      // as two soft redirects, and the store PC was left on a blank white
      // page until a manual reload (reported 2026-09-18). A hard navigation
      // is what that manual reload did; it also drops any data cached from
      // a previous user of a shared computer.
      let role: string | null = null;
      try {
        role = (await noteLogin.mutateAsync({ kind: "login_ok" })).role;
      } catch {
        role = null; // inactive account etc. — the server decides what to show
      }
      const locale = window.location.pathname.split("/")[1] === "en" ? "en" : "tr";
      keepBusy = true;
      window.location.assign(`/${locale}/${role && role !== "admin" ? "upload" : "admin"}`);
    } finally {
      if (!keepBusy) setLoading(false);
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
      const locale = (window.location.pathname.split("/")[1] === "en" ? "en" : "tr") as "tr" | "en";
      // Server first: with the app's own mail transport the link works from
      // any browser and reaches every user. Otherwise Supabase's mailer.
      const r = await forgotMut.mutateAsync({ email: email.trim(), locale });
      if (r.via === "supabase") {
        const supabase = createClient();
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/${locale}/reset-password`,
        });
        if (error) {
          toast.error(`Bağlantı gönderilemedi: ${error.message}`);
          return;
        }
        toast.success("Şifre sıfırlama bağlantısı e-postanıza gönderildi. Bu tarayıcıda açın.");
        return;
      }
      toast.success("Bu adres kayıtlıysa şifre sıfırlama bağlantısı gönderildi; gelen kutunuzu (ve Spam'i) kontrol edin.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
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
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            {failed > 0 ? (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Giriş reddedildi. Göz simgesine basıp yazdığınız şifreye bakın: tarayıcı eski bir
                şifreyi kendisi doldurmuş, Caps Lock açık ya da klavye dili farklı olabilir.
                {failed >= 2 ? " Emin değilseniz aşağıdaki \"Şifremi unuttum\" ile yenisini belirleyin." : ""}
              </p>
            ) : null}
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
