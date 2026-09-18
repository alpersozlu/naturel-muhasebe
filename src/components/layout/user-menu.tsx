"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LogOut, KeyRound } from "lucide-react";
import { ChangePasswordDialog } from "@/components/layout/change-password-dialog";
import { createClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function UserMenu({ email, name }: { email: string; name?: string | null }) {
  const t = useTranslations("auth");

  const initial = (name ?? email)[0]?.toUpperCase() ?? "?";
  const [pwOpen, setPwOpen] = useState(false);

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
    // Full load: a soft refresh through the middleware redirect can leave a
    // blank page, and a shared store PC must not keep the last user's data.
    window.location.assign(`/${window.location.pathname.split("/")[1] === "en" ? "en" : "tr"}/login`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="outline-none">
        <Avatar className="h-9 w-9 bg-pink-500 text-white">
          <AvatarFallback className="bg-pink-500 text-white">{initial}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="font-medium">{name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setPwOpen(true)}>
          <KeyRound className="h-4 w-4 mr-2" />
          Şifremi değiştir
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={signOut} className="text-destructive">
          <LogOut className="h-4 w-4 mr-2" />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} email={email} />
    </DropdownMenu>
  );
}
