import type { ReactNode } from "react";
import { cn } from "@xue-learn/core/utils";

type UnderlineTabListProps = {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
};

export function UnderlineTabList({
  children,
  className,
  "aria-label": ariaLabel,
}: UnderlineTabListProps) {
  return (
    <div
      className={cn("flex gap-0 border-b border-[var(--border-200)]", className)}
      role="tablist"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

type UnderlineTabProps = {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  activeClassName?: string;
  inactiveClassName?: string;
  indicatorClassName?: string;
};

export function UnderlineTab({
  label,
  active,
  disabled,
  onClick,
  className,
  activeClassName = "font-semibold text-[var(--brand-600)]",
  inactiveClassName = "font-medium text-[var(--text-400)] hover:text-[var(--text-800)]",
  indicatorClassName = "bg-[var(--brand-500)]",
}: UnderlineTabProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative px-4 py-2.5 text-sm transition-colors",
        active ? activeClassName : inactiveClassName,
        disabled && "cursor-not-allowed opacity-40",
        className,
      )}
    >
      <span className="inline-grid">
        <span
          className={cn(
            "col-start-1 row-start-1",
            active ? "font-semibold" : "font-medium",
          )}
        >
          {label}
        </span>
        <span
          className="invisible col-start-1 row-start-1 font-semibold"
          aria-hidden
        >
          {label}
        </span>
      </span>
      <span
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-0.5",
          active ? indicatorClassName : "bg-transparent",
        )}
        aria-hidden
      />
    </button>
  );
}
