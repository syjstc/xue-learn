"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_MATERIAL_PRESENTATION,
  type MaterialPresentationState,
  readMaterialPresentation,
  writeMaterialPresentation,
} from "@/shared/domain/material-presentation";

export function useMaterialPresentation(
  unitId: string,
  slideCount: number,
  initial?: MaterialPresentationState | null | undefined,
  onActivity?: (state: MaterialPresentationState) => void,
) {
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<MaterialPresentationState>(
    DEFAULT_MATERIAL_PRESENTATION,
  );
  const initialAppliedRef = useRef(false);
  const presentationSeed =
    initial === undefined
      ? "local"
      : `${initial?.slideIndex ?? 0}:${initial?.hasCompletedSlides ?? false}`;

  useEffect(() => {
    initialAppliedRef.current = false;
    setHydrated(false);
  }, [unitId, presentationSeed]);

  useEffect(() => {
    if (initial === undefined) {
      if (!initialAppliedRef.current) {
        setState(readMaterialPresentation(unitId));
      }
      setHydrated(true);
      return;
    }
    if (!initialAppliedRef.current) {
      const local = readMaterialPresentation(unitId);
      const remote = initial ?? local;
      setState({
        slideIndex: remote.slideIndex,
        hasCompletedSlides: remote.hasCompletedSlides,
        sectionSteps: remote.sectionSteps ?? local.sectionSteps ?? {},
        sectionCursors: remote.sectionCursors ?? {},
      });
      initialAppliedRef.current = true;
    }
    setHydrated(true);
  }, [initial, unitId]);

  const persist = useCallback(
    (
      updater: (prev: MaterialPresentationState) => MaterialPresentationState,
    ) => {
      setState((prev) => {
        const next = updater(prev);
        writeMaterialPresentation(unitId, next);
        onActivity?.(next);
        return next;
      });
    },
    [onActivity, unitId],
  );

  const clampedIndex =
    slideCount > 0 ? Math.min(state.slideIndex, slideCount - 1) : 0;

  const setSlideIndex = useCallback(
    (slideIndex: number) => {
      const max = Math.max(0, slideCount - 1);
      persist((prev) => ({
        ...prev,
        slideIndex: Math.max(0, Math.min(slideIndex, max)),
      }));
    },
    [persist, slideCount],
  );

  const markSlidesCompleted = useCallback(() => {
    setState((prev) => {
      if (prev.hasCompletedSlides) return prev;
      const next = { ...prev, hasCompletedSlides: true };
      writeMaterialPresentation(unitId, next);
      onActivity?.(next);
      return next;
    });
  }, [onActivity, unitId]);

  const getSectionStep = useCallback(
    (sectionIndex: number) => state.sectionSteps?.[sectionIndex] ?? 0,
    [state.sectionSteps],
  );

  const setSectionStep = useCallback(
    (sectionIndex: number, stepIndex: number) => {
      persist((prev) => ({
        ...prev,
        sectionSteps: {
          ...(prev.sectionSteps ?? {}),
          [sectionIndex]: Math.max(0, stepIndex),
        },
      }));
    },
    [persist],
  );

  const goNext = useCallback(() => {
    if (slideCount <= 0) return;
    const atEnd = clampedIndex >= slideCount - 1;
    if (atEnd) {
      markSlidesCompleted();
      return;
    }
    setSlideIndex(clampedIndex + 1);
  }, [clampedIndex, markSlidesCompleted, setSlideIndex, slideCount]);

  const goPrev = useCallback(() => {
    setSlideIndex(clampedIndex - 1);
  }, [clampedIndex, setSlideIndex]);

  return {
    hydrated,
    slideIndex: clampedIndex,
    hasCompletedSlides: state.hasCompletedSlides,
    sectionSteps: state.sectionSteps ?? {},
    setSlideIndex,
    getSectionStep,
    setSectionStep,
    goNext,
    goPrev,
    markSlidesCompleted,
  };
}
