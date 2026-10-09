import type { CSSProperties, PointerEventHandler } from "react";
import { cn } from "@xue-learn/core/utils";

type ResizablePanelHandleProps = {
  panelSide: "left" | "right";
  label: string;
  min: number;
  max: number;
  value: number;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onResizeBy: (delta: number) => void;
  onReset?: () => void;
  className?: string;
  style?: CSSProperties;
  assistantHandle?: boolean;
};

/** Shared vertical resize edge for panels docked to either side of the app. */
export function ResizablePanelHandle({
  panelSide,
  label,
  min,
  max,
  value,
  onPointerDown,
  onResizeBy,
  onReset,
  className,
  style,
  assistantHandle = false,
}: ResizablePanelHandleProps) {
  return (
    <div
      data-resizable-panel-handle
      data-assistant-resize-handle={assistantHandle || undefined}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      className={cn(
        "group w-3 cursor-col-resize touch-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-400)]",
        className,
      )}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const screenDelta = event.key === "ArrowLeft" ? -16 : 16;
        onResizeBy(panelSide === "left" ? screenDelta : -screenDelta);
      }}
    >
      <span className="pointer-events-none absolute top-1/2 left-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--border-200)] opacity-0 transition-[background-color,opacity] group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100" />
    </div>
  );
}
