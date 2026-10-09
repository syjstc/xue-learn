"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ConfirmContext,
  type AlertOptions,
  type ConfirmOptions,
} from "@/hooks/use-confirm";
import { useI18n } from "@xue-learn/core/i18n";

type DialogState = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: "default" | "destructive" | "alert";
  mode: "confirm" | "alert";
};

const initialState: DialogState = {
  open: false,
  title: "",
  description: undefined,
  confirmLabel: "",
  cancelLabel: "",
  variant: "default",
  mode: "confirm",
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<DialogState>(initialState);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const modeRef = useRef<"confirm" | "alert">("confirm");

  const settle = useCallback((result: boolean) => {
    if (modeRef.current === "alert") {
      resolveRef.current?.(true);
    } else {
      resolveRef.current?.(result);
    }
    resolveRef.current = null;
    setState((prev) => ({ ...prev, open: false }));
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current?.(false);
        resolveRef.current = resolve;
        modeRef.current = "confirm";
        setState({
          open: true,
          title: options.title,
          description: options.description,
          confirmLabel:
            options.confirmLabel ??
            (options.variant === "destructive"
              ? t("common.delete")
              : t("common.confirm")),
          cancelLabel: options.cancelLabel ?? t("common.cancel"),
          variant: options.variant ?? "default",
          mode: "confirm",
        });
      }),
    [t],
  );

  const alert = useCallback(
    (options: AlertOptions) =>
      new Promise<void>((resolve) => {
        resolveRef.current?.(false);
        resolveRef.current = () => resolve();
        modeRef.current = "alert";
        setState({
          open: true,
          title: options.title,
          description: options.description,
          confirmLabel: options.confirmLabel ?? t("common.ok"),
          cancelLabel: "",
          variant: "alert",
          mode: "alert",
        });
      }),
    [t],
  );

  const value = useMemo(() => ({ confirm, alert }), [confirm, alert]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={state.open}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
        title={state.title}
        description={state.description}
        confirmLabel={state.confirmLabel}
        cancelLabel={state.cancelLabel}
        variant={state.variant}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  );
}
