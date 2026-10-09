"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { DesktopTitlebarPortal } from "@/components/layout/desktop-titlebar";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

export function ImmersiveLearningPortal({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return active ? createPortal(children, document.body) : children;
}

export function ImmersiveEnterFocusButton({
  onEnter,
}: {
  onEnter: () => void;
}) {
  const t = useT();
  const button = (desktopTitlebar: boolean) => (
    <Button
      data-desktop-immersive-enter={desktopTitlebar || undefined}
      data-inline-immersive-enter={!desktopTitlebar || undefined}
      type="button"
      size="icon-sm"
      variant="ghost"
      className={desktopTitlebar ? "order-last ml-auto rounded-md" : undefined}
      aria-label={t("learningScene.focus")}
      title={t("learningScene.focus")}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onEnter();
      }}
    >
      <Maximize2 aria-hidden />
    </Button>
  );

  return (
    <>
      <DesktopTitlebarPortal>{button(true)}</DesktopTitlebarPortal>
      {button(false)}
    </>
  );
}

export function ImmersiveTopControls({ onExit }: { onExit: () => void }) {
  const t = useT();
  return (
    <>
      <DesktopTitlebarPortal>
        <div
          data-desktop-immersive-controls
          className="order-last ml-auto flex shrink-0 items-center gap-1"
        >
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="rounded-md"
            aria-label={t("learningScene.exitFocus")}
            title={t("learningScene.exitFocus")}
            onClick={onExit}
          >
            <Minimize2 aria-hidden />
          </Button>
        </div>
      </DesktopTitlebarPortal>
      <div className="immersive-top-controls fixed top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] z-[calc(var(--z-fullscreen)+3)] flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="rounded-full bg-background/95 shadow-md backdrop-blur"
          aria-label={t("learningScene.exitFocus")}
          title={t("learningScene.exitFocus")}
          onClick={onExit}
        >
          <Minimize2 aria-hidden />
        </Button>
      </div>
    </>
  );
}
