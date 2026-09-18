"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { NrLogo } from "@/components/brand/nr-logo";

/**
 * Landing page of the "Şifremi unuttum" e-mail. Three link styles arrive:
 *
 *  - `?token_hash=…&type=recovery` — the app's own mail. Verified here with
 *    verifyOtp; independent of Supabase's Site URL / redirect allow-list and
 *    of the browser that asked. Verification needs this page's JavaScript,
 *    so a mail scanner that merely fetches the link does not burn the token.
 *  - `?code=…` — Supabase's mailer with PKCE (same browser only).
 *  - `#access_token=…&type=recovery` — older Supabase redirect style.
 *
 * Any of them ends in a session; the new password is then set with
 * updateUser.
 */
function explain(message: string | undefined, code: string | undefined): string {
  const m = `${code ?? ""} ${message ?? ""}`;
  if (/expired|otp_expired|invalid.*token|token.*invalid/i.test(m)) {
    return "Bu bağlantının süresi dolmuş ya da daha önce kullanılmış.";
  }
  if (/code verifier|pkce|flow state/i.test(m)) {
    return "Bu bağlantı yalnızca istendiği tarayıcıda açılabiliyor.";
  }
  if (/jwt|malformed|bad_jwt/i.test(m)) return "Bu bağlantı geçersiz.";
  return message ? `Bu bağlantı doğrulanamadı (${message}).` : "Bu bağlantı doğrulanamadı.";
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<"checking" | "ok" | "invalid">("checking");
  const [reason, setReason] = useState<string | null>(null);
  const [account, setAccount] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [saving, setSaving] = useState(false);
  const started = useRef(false);
  const noteLogin = trpc.auth.noteLogin.useMutation();

  useEffect(() => {
    // One-time tokens: never verify twice (React strict mode re-runs effects).
    if (started.current) return;
    started.current = true;
    const supabase = createClient();
    const fail = (text: string) => {
      setReason(text);
      setReady("invalid");
    };
    const run = async () => {
      const q = new URLSearchParams(window.location.search);
      const h = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const desc = q.get("error_description") ?? h.get("error_description");
      if (desc) return fail(explain(desc, q.get("error_code") ?? h.get("error_code") ?? undefined));

      const tokenHash = q.get("token_hash");
      const code = q.get("code");
      const accessToken = h.get("access_token");
      const refreshToken = h.get("refresh_token");
      let viaLink = false;
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
        if (error) return fail(explain(error.message, (error as { code?: string }).code));
        viaLink = true;
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) return fail(explain(error.message, (error as { code?: string }).code));
        viaLink = true;
      } else if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) return fail(explain(error.message, (error as { code?: string }).code));
        viaLink = true;
      }
      // Drop the one-time values from the address bar so a refresh does not
      // retry them (the session is already in the cookies).
      if (viaLink) window.history.replaceState({}, "", window.location.pathname);

      const { data } = await supabase.auth.getUser();
      if (!data.user) return fail("Bu bağlantı geçersiz ya da süresi dolmuş.");
      setAccount(data.user.email ?? "");
      setReady("ok");
    };
    void run();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) {
      toast.error("Şifre en az 6 karakter olmalı");
      return;
    }
    if (pw !== pw2) {
      toast.error("İki şifre aynı değil");
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: pw });
      const code = (error as { code?: string } | null)?.code ?? "";
      // "Same as the old one" is not a failure for the person: that password
      // is valid, and they are signed in.
      if (error && code !== "same_password" && !/different from the old/i.test(error.message)) {
        if (code === "weak_password" || /weak|at least/i.test(error.message)) {
          toast.error("Şifre çok zayıf bulundu — daha uzun bir şifre yazın.");
        } else if (/session|jwt|not authenticated/i.test(error.message)) {
          toast.error("Oturum süresi doldu — giriş sayfasından yeni bağlantı isteyin.");
        } else {
          toast.error(`Şifre güncellenemedi: ${error.message}`);
        }
        return;
      }
      noteLogin.mutate({ kind: "recovery_completed" });
      toast.success("Şifreniz güncellendi");
      const locale = window.location.pathname.split("/")[1] || "tr";
      router.replace(`/${locale}/upload`);
      router.refresh();
    } finally {
      setSaving(false);
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
              <div className="text-xs text-muted-foreground">Yeni şifre belirle</div>
            </div>
          </div>

          {ready === "checking" ? (
            <p className="text-sm text-muted-foreground">Bağlantı doğrulanıyor…</p>
          ) : ready === "invalid" ? (
            <div className="text-sm space-y-3">
              <p>{reason ?? "Bu bağlantı geçersiz ya da süresi dolmuş."}</p>
              <p className="text-muted-foreground">
                Giriş sayfasından &quot;Şifremi unuttum&quot; ile yeni bir bağlantı isteyin. Bağlantı
                bir saat geçerlidir ve bir kez kullanılır; birden fazla mail geldiyse en sonuncuyu açın.
              </p>
              <Button variant="outline" className="w-full" onClick={() => router.replace("/tr/login")}>
                Giriş sayfasına dön
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {/* The account name lets the browser's password manager update
                  the right saved login instead of keeping the old password
                  and autofilling it at the next sign-in. */}
              <div className="space-y-2">
                <Label htmlFor="account">Hesap</Label>
                <input
                  id="account"
                  name="username"
                  type="email"
                  autoComplete="username"
                  value={account}
                  readOnly
                  className="flex h-10 w-full rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw">Yeni şifre</Label>
                <PasswordInput
                  id="pw"
                  name="new-password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  autoComplete="new-password"
                  placeholder="En az 6 karakter"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw2">Yeni şifre (tekrar)</Label>
                <PasswordInput
                  id="pw2"
                  name="new-password-repeat"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  autoComplete="new-password"
                />
                {pw2.length > 0 && pw !== pw2 ? <p className="text-xs text-rose-600">İki şifre aynı değil</p> : null}
              </div>
              <Button type="submit" className="w-full" disabled={saving || pw.length < 6 || pw !== pw2}>
                {saving ? "Kaydediliyor…" : "Şifreyi kaydet ve giriş yap"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
