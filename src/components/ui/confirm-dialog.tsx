"use client";

import { AlertTriangle, Info } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { cn } from "@xue-learn/core/source/src/lib/utils.ts";

export type ConfirmDialogVariant = "default" | "destructive" | "alert";

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  loading?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
};

const variantStyles: Record<
  ConfirmDialogVariant,
  { icon: typeof Info; iconClass: string; badgeClass: string }
> = {
  default: {
    icon: Info,
    iconClass: "text-primary",
    badgeClass: "bg-muted text-muted-foreground",
  },
  destructive: {
    icon: AlertTriangle,
    iconClass: "text-destructive",
    badgeClass: "bg-[var(--danger-soft)] text-destructive",
  },
  alert: {
    icon: AlertTriangle,
    iconClass: "text-destructive",
    badgeClass: "bg-[var(--danger-soft)] text-destructive",
  },
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const isAlert = variant === "alert";
  const styles = variantStyles[variant];
  const Icon = styles.icon;

  function handleCancel() {
    onCancel?.();
    onOpenChange(false);
  }

  function handleConfirm() {
    onConfirm();
    if (!loading) {
      onOpenChange(false);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            "fixed inset-0 isolate z-confirm bg-black/20 duration-200 ease-out supports-backdrop-filter:backdrop-blur-xs",
            "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Popup
          role="alertdialog"
          aria-modal
          className={cn(
            "fixed top-1/2 left-1/2 z-confirm w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2",
            "overflow-hidden rounded-xl bg-popover text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10",
            "outline-none duration-200 ease-out sm:max-w-md",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
        >
          <div className="flex gap-3 p-4">
            <span
              className={cn(
                "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
                styles.badgeClass,
              )}
              aria-hidden="true"
            >
              <Icon className={cn("size-4", styles.iconClass)} />
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <DialogPrimitive.Title className="text-base leading-snug font-semibold text-foreground">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="whitespace-pre-line text-sm text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t bg-muted/50 px-4 py-3 sm:flex-row sm:justify-end">
            {!isAlert ? (
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={handleCancel}
              >
                {cancelLabel}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={variant === "destructive" ? "destructive" : "default"}
              disabled={loading}
              onClick={handleConfirm}
            >
              {loading ? "…" : confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
