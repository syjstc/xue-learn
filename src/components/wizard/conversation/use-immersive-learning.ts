"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useLocation } from "react-router-dom";
import { useAssistant } from "@/components/agent/assistant-provider";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";

type UseImmersiveLearningOptions = {
  unitId: string;
  immersiveJourneyOpen?: boolean;
  onCloseImmersiveJourney?: () => void;
  referenceOpen?: boolean;
  onCloseReference?: () => void;
};

export function useImmersiveLearning({
  unitId,
  immersiveJourneyOpen = false,
  onCloseImmersiveJourney,
  referenceOpen = false,
  onCloseReference,
}: UseImmersiveLearningOptions) {
  const location = useLocation();
  const [focusMode, setFocusMode] = useState(() =>
    Boolean(
      (location.state as { preserveImmersiveLearning?: boolean } | null)
        ?.preserveImmersiveLearning ||
      (typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 700px)").matches),
    ),
  );
  const [focusModeLeaving, setFocusModeLeaving] = useState(false);
  const exitTimerRef = useRef<number | null>(null);
  const {
    open: assistantOpen,
    companionExpanded,
    companionReserveWidth,
    activeFollowUpUnitId,
    setImmersiveLearningActive,
    closeAssistant,
    closeUnitFollowUp,
  } = useAssistant();
  const immersiveAssistantOpen = focusMode && assistantOpen;
  const immersiveCompanionOpen = focusMode && companionExpanded;
  const immersiveFollowUpOpen =
    immersiveAssistantOpen && activeFollowUpUnitId === unitId;

  const exitImmersiveMode = useCallback(() => {
    if (!focusMode || focusModeLeaving) return;
    setFocusModeLeaving(true);
    exitTimerRef.current = window.setTimeout(() => {
      setFocusMode(false);
      setFocusModeLeaving(false);
      exitTimerRef.current = null;
    }, 180);
  }, [focusMode, focusModeLeaving]);

  const enterFocusMode = useCallback(() => {
    setFocusMode(true);
  }, []);

  useEffect(
    () => () => {
      if (exitTimerRef.current != null) {
        window.clearTimeout(exitTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!focusMode) {
      setImmersiveLearningActive(false);
      return;
    }
    setImmersiveLearningActive(true);
    return () => setImmersiveLearningActive(false);
  }, [focusMode, setImmersiveLearningActive]);

  useEffect(() => {
    if (!focusMode) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (immersiveJourneyOpen) {
        onCloseImmersiveJourney?.();
        return;
      }
      if (
        immersiveFollowUpOpen &&
        document
          .getElementById("assistant-companion-surface")
          ?.contains(document.activeElement)
      ) {
        closeUnitFollowUp();
        return;
      }
      if (
        immersiveCompanionOpen &&
        document
          .getElementById("assistant-companion-surface")
          ?.contains(document.activeElement)
      ) {
        closeAssistant();
        return;
      }
      if (referenceOpen) {
        onCloseReference?.();
        return;
      }
      const nestedDialog = document.querySelector(
        '[role="dialog"]:not([data-guided-scene-root="true"])',
      );
      if (nestedDialog) return;
      exitImmersiveMode();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    closeAssistant,
    closeUnitFollowUp,
    exitImmersiveMode,
    focusMode,
    immersiveAssistantOpen,
    immersiveCompanionOpen,
    immersiveFollowUpOpen,
    immersiveJourneyOpen,
    onCloseImmersiveJourney,
    onCloseReference,
    referenceOpen,
  ]);

  const workspaceClassName = cn(
    "immersive-learning-workspace min-w-0 text-foreground transition-[right,width] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
    focusMode &&
      cn(
        "fixed inset-0 z-fullscreen flex h-[100dvh] w-screen flex-col overflow-hidden bg-background",
        focusModeLeaving
          ? "animate-[immersiveWorkspaceOut_180ms_ease-in_forwards]"
          : "animate-[immersiveWorkspaceIn_240ms_cubic-bezier(0.22,1,0.36,1)]",
      ),
  );

  const workspaceStyle = {
    "--immersive-assistant-width": `${companionReserveWidth}px`,
  } as CSSProperties;

  return {
    focusMode,
    focusModeLeaving,
    enterFocusMode,
    exitImmersiveMode,
    immersiveAssistantOpen,
    immersiveCompanionOpen,
    workspaceClassName,
    workspaceStyle,
  };
}
