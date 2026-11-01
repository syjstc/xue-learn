"use client";
import { useT } from "@xue-learn/core/i18n";

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
  const t = useT();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      disabled={disabled}
      onClick={() => void onStop()}
    >
      {t("goalCreation.stop")}
    </Button>
  );
}
