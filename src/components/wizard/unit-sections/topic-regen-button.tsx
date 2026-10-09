"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

export function TopicRegenButton({
  busy = false,
  disabled = false,
  onClick,
}: {
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={disabled || busy}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      <RotateCcw className={busy ? "animate-spin" : undefined} aria-hidden />
      {t("wizard.section.regenerateTopic")}
    </Button>
  );
}
