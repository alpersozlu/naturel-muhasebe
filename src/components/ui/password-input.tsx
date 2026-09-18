"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Password field with a show/hide toggle and a Caps Lock notice. A hidden
 * password is the main reason a person is "sure" of a password the server
 * rejects — wrong keyboard layout, Caps Lock, a stale autofill. Letting
 * them look removes the guesswork.
 */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "type">
>(({ className, onKeyUp, onKeyDown, onBlur, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);
  const [caps, setCaps] = React.useState(false);
  const track = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") setCaps(e.getModifierState("CapsLock"));
  };
  return (
    <div className="space-y-1">
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn("pr-10", className)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onKeyUp={(e) => {
            track(e);
            onKeyUp?.(e);
          }}
          onKeyDown={(e) => {
            track(e);
            onKeyDown?.(e);
          }}
          onBlur={(e) => {
            setCaps(false);
            onBlur?.(e);
          }}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Şifreyi gizle" : "Şifreyi göster"}
          title={visible ? "Şifreyi gizle" : "Şifreyi göster"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {caps ? <p className="text-xs text-amber-700">Caps Lock açık</p> : null}
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
