"use client";

import { Button } from "@xue-learn/core/ui/button";

export function AiGenStopButton({
  onStop,
  disabled,
  className,
}: {
  onStop: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      disabled={disabled}
      onClick={() => void onStop()}
    >
      停止
    </Button>
  );
}
