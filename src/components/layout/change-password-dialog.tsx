"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/**
 * Self-service password change from the user menu. Asks for the current
 * password (checked on the server) and carries the account name so the
 * browser's password manager updates the right saved login.
 */
export function ChangePasswordDialog({
  open,
  onClose,
  email,
}: {
  open: boolean;
  onClose: () => void;
  email: string;
}) {
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const reset = () => {
    setCurrent("");
    setPw("");
    setPw2("");
  };
  const change = trpc.auth.changePassword.useMutation({
    onSuccess: async (_data, vars) => {
      // Measured 2026-09-18: a password set through the admin API revokes
      // every session of the account, this one included. Sign straight back
      // in with the new password so the person is not thrown out.
      const { error } = await createClient().auth.signInWithPassword({ email, password: vars.password });
      reset();
      onClose();
      if (error) {
        toast.success("Şifreniz güncellendi — yeni şifrenizle yeniden giriş yapın.");
        window.location.assign(`/${window.location.pathname.split("/")[1] || "tr"}/login?email=${encodeURIComponent(email)}`);
        return;
      }
      toast.success("Şifreniz güncellendi. Diğer cihazlardaki oturumlar kapatıldı.");
    },
    onError: (e) => toast.error(e.message),
  });
  const mismatch = pw2.length > 0 && pw !== pw2;
  const canSave = !change.isPending && current.length > 0 && pw.length >= 6 && pw === pw2;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !change.isPending) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Şifremi değiştir</DialogTitle>
          <DialogDescription>
            Önce mevcut şifrenizi, sonra yeni şifrenizi iki kez yazın (en az 6 karakter).
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) change.mutate({ current, password: pw });
          }}
        >
          <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
          <div className="space-y-1.5">
            <Label htmlFor="cp-cur">Mevcut şifre</Label>
            <PasswordInput id="cp-cur" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-pw">Yeni şifre</Label>
            <PasswordInput id="cp-pw" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-pw2">Yeni şifre (tekrar)</Label>
            <PasswordInput id="cp-pw2" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            {mismatch ? <p className="text-xs text-rose-600">İki şifre aynı değil</p> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Mevcut şifrenizi hatırlamıyorsanız çıkış yapıp giriş ekranındaki &quot;Şifremi unuttum&quot;u kullanın.
          </p>
          <DialogFooter className="gap-2 pt-1">
            <Button type="button" variant="outline" disabled={change.isPending} onClick={() => { reset(); onClose(); }}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={!canSave}>
              {change.isPending ? "Kaydediliyor…" : "Şifreyi kaydet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
