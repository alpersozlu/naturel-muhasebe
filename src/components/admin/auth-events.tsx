"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";

const KIND: Record<string, string> = {
  login_ok: "Giriş yaptı",
  login_failed: "Giriş reddedildi",
  recovery_requested: "Şifre sıfırlama istedi",
  recovery_completed: "Bağlantıyla yeni şifre belirledi",
  password_changed: "Şifresini değiştirdi",
  password_set_by_admin: "Şifreyi yönetici belirledi",
};

/** Plain-language reading of the machine reason. */
function explain(kind: string, reason: string | null): string {
  const r = reason ?? "";
  if (kind === "login_failed") {
    if (/no_such_user/.test(r)) return "Bu e-posta ile kayıtlı hesap yok — adres yanlış yazılmış";
    if (/inactive|banned/.test(r)) return "Hesap devre dışı";
    if (/invalid_credentials|invalid login/i.test(r)) return "E-posta doğru, şifre yanlış";
    if (/rate/i.test(r)) return "Çok fazla deneme";
    if (/email_not_confirmed/.test(r)) return "E-posta onaylanmamış";
    return r;
  }
  if (kind === "recovery_requested") {
    if (/mail_sent/.test(r)) return "Bağlantı e-postayla gönderildi";
    if (/no_such_user/.test(r)) return "Kayıtlı olmayan adres — mail gönderilmedi";
    if (/inactive/.test(r)) return "Hesap devre dışı — mail gönderilmedi";
    if (/mail_failed/.test(r)) return `Mail gönderilemedi (${r.replace(/^mail_failed:\s*/, "")})`;
    if (/via_supabase/.test(r)) return "Supabase postacısı ile";
    return r;
  }
  if (kind === "password_changed" && /current_password_rejected/.test(r)) return "Mevcut şifre yanlış girildi — değişmedi";
  if (kind === "password_set_by_admin") return r.replace(/^invite by /, "davetle, ").replace(/^by /, "");
  return "";
}

function device(ua: string | null): string {
  if (!ua) return "";
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "";
  return [os, br].filter(Boolean).join(" · ");
}

/** Admin: recent sign-in and password events, collapsed by default. */
export function AuthEvents() {
  const [open, setOpen] = useState(false);
  const q = trpc.auth.recentEvents.useQuery({ limit: 40 }, { enabled: open });
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Giriş ve şifre kayıtları
        <span className="ml-auto text-xs font-normal text-muted-foreground">son 40 olay · şifreler kaydedilmez</span>
      </button>
      {open ? (
        <div className="border-t">
          {q.isLoading ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">Yükleniyor…</p>
          ) : !q.data?.length ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">Henüz kayıt yok.</p>
          ) : (
            <ul className="divide-y text-sm">
              {q.data.map((e) => (
                <li key={e.id} className="grid gap-x-4 gap-y-0.5 px-4 py-2 sm:grid-cols-[9.5rem_minmax(0,1fr)_minmax(0,1.4fr)]">
                  <span className="tabular-nums text-muted-foreground">
                    {new Date(e.created_at).toLocaleString("tr-TR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/Istanbul",
                    })}
                  </span>
                  <span className="truncate">{e.email}</span>
                  <span className={e.kind === "login_failed" ? "text-rose-700" : ""}>
                    {KIND[e.kind] ?? e.kind}
                    {explain(e.kind, e.reason) ? <span className="text-muted-foreground"> — {explain(e.kind, e.reason)}</span> : null}
                    {device(e.user_agent) ? <span className="text-muted-foreground"> · {device(e.user_agent)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
