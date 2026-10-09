import * as React from "react";
import { cn } from "@xue-learn/core/source/src/lib/utils.ts";

export interface SliderProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange"> {
  value?: number[];
  defaultValue?: number[];
  onValueChange?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function Slider({
  className,
  value,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  ...props
}: SliderProps) {
  const currentValue = value?.[0] ?? defaultValue?.[0] ?? min;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = parseFloat(e.target.value);
    onValueChange?.([nextVal]);
  };

  return (
    <div className={cn("relative flex w-full touch-none select-none items-center", className)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={currentValue}
        disabled={disabled}
        onChange={handleChange}
        className={cn(
          "w-full h-2 rounded-lg bg-[var(--color-bg-muted,#e2e8f0)] dark:bg-[var(--color-bg-muted,#334155)]",
          "accent-[var(--color-primary)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/50"
        )}
        {...props}
      />
    </div>
  );
}
