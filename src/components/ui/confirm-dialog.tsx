"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * In-app confirmation instead of the browser's `confirm()` — that one
 * shows "<host> says" in the browser's own chrome, cannot be styled and
 * reads like an error. One dialog is mounted once (ConfirmProvider);
 * `useConfirm()` hands back a function that resolves true when the
 * person confirms, false otherwise (cancel, Esc, click outside).
 */
export type ConfirmOptions = {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for deletes and other one-way actions. */
  destructive?: boolean;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{
    opts: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);

  const confirm = React.useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setState({ opts, resolve });
    });
  }, []);

  const settle = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={state !== null} onOpenChange={(open) => !open && settle(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{state?.opts.title}</DialogTitle>
            {state?.opts.description ? (
              <DialogDescription className="whitespace-pre-line leading-relaxed">
                {state.opts.description}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => settle(false)} autoFocus>
              {state?.opts.cancelLabel ?? "Vazgeç"}
            </Button>
            <Button
              variant={state?.opts.destructive ? "destructive" : "default"}
              onClick={() => settle(true)}
            >
              {state?.opts.confirmLabel ?? "Onayla"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const fn = React.useContext(ConfirmContext);
  if (!fn) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return fn;
}
