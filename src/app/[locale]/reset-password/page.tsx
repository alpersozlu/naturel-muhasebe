"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { NrLogo } from "@/components/brand/nr-logo";

/**
 * Landing page of the "Şifremi unuttum" e-mail. Supabase sends the person
 * here with `?code=…` (PKCE) — the browser client exchanges it for a
 * session, then the new password is set with updateUser. Opened in a
 * different browser than the one that asked, the exchange fails and the
 * page says so.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<"checking" | "ok" | "invalid">("checking");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const run = async () => {
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setReady("invalid");
          return;
        }
        // Drop the code from the address bar so a refresh does not retry it.
        window.history.replaceState({}, "", window.location.pathname);
      }
      const { data } = await supabase.auth.getSession();
      setReady(data.session ? "ok" : "invalid");
    };
    void run();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) {
      toast.error("Şifre en az 8 karakter olmalı");
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
      if (error) {
        toast.error(`Şifre güncellenemedi: ${error.message}`);
        return;
      }
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
              <p>Bu bağlantı geçersiz ya da süresi dolmuş.</p>
              <p className="text-muted-foreground">
                Bağlantıyı, şifre sıfırlamayı istediğiniz tarayıcıda açın. Olmazsa giriş sayfasından
                &quot;Şifremi unuttum&quot; ile yeni bağlantı isteyin.
              </p>
              <Button variant="outline" className="w-full" onClick={() => router.replace("/tr/login")}>
                Giriş sayfasına dön
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pw">Yeni şifre</Label>
                <Input
                  id="pw"
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  autoComplete="new-password"
                  placeholder="En az 8 karakter"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw2">Yeni şifre (tekrar)</Label>
                <Input
                  id="pw2"
                  type="password"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={saving || pw.length < 8 || pw !== pw2}>
                {saving ? "Kaydediliyor…" : "Şifreyi kaydet ve giriş yap"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
