"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/** Self-service password change from the user menu. */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const change = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("Şifreniz güncellendi");
      setPw("");
      setPw2("");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const mismatch = pw2.length > 0 && pw !== pw2;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !change.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Şifremi değiştir</DialogTitle>
          <DialogDescription>Yeni şifrenizi iki kez yazın (en az 6 karakter).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="cp-pw">Yeni şifre</Label>
            <Input id="cp-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-pw2">Yeni şifre (tekrar)</Label>
            <Input id="cp-pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            {mismatch ? <p className="text-xs text-rose-600">İki şifre aynı değil</p> : null}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={change.isPending} onClick={onClose}>
            Vazgeç
          </Button>
          <Button disabled={change.isPending || pw.length < 6 || pw !== pw2} onClick={() => change.mutate({ password: pw })}>
            {change.isPending ? "Kaydediliyor…" : "Şifreyi kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
