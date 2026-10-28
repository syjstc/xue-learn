import { useCallback, useRef } from "react";
import type {
  CompositionEvent,
  FormHTMLAttributes,
  KeyboardEvent,
} from "react";
import {
  isImeComposingFromEvent,
  preventImeEnterSubmit,
} from "@/shared/ime";

/**
 * Tracks IME composition on an element (input, textarea, or form).
 * Spreads `compositionProps` on inputs, or use `formProps` / `ImeSafeForm`.
 */
export function useImeComposition() {
  const composingRef = useRef(false);

  const onCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const onCompositionEnd = useCallback(() => {
    // Enter to confirm IME may fire keydown after compositionend in the same tick.
    setTimeout(() => {
      composingRef.current = false;
    }, 0);
  }, []);

  const isComposing = useCallback(
    (event?: KeyboardEvent) =>
      composingRef.current ||
      (event ? isImeComposingFromEvent(event) : false),
    [],
  );

  const onEnterKeyDown = useCallback(
    (handler: (event: KeyboardEvent) => void) =>
      (event: KeyboardEvent) => {
        if (!event.key || event.key !== "Enter") return;
        if (isComposing(event)) return;
        handler(event);
      },
    [isComposing],
  );

  const compositionProps = {
    onCompositionStart,
    onCompositionEnd,
  };

  const formProps: Pick<
    FormHTMLAttributes<HTMLFormElement>,
    "onCompositionStart" | "onCompositionEnd" | "onKeyDown"
  > = {
    onCompositionStart: (event: CompositionEvent<HTMLFormElement>) => {
      onCompositionStart();
      // Bubble from child inputs is enough; this handles direct form listeners too.
      void event;
    },
    onCompositionEnd: (event: CompositionEvent<HTMLFormElement>) => {
      onCompositionEnd();
      void event;
    },
    onKeyDown: (event: KeyboardEvent<HTMLFormElement>) => {
      preventImeEnterSubmit(event, composingRef.current);
    },
  };

  return {
    isComposing,
    onEnterKeyDown,
    compositionProps,
    formProps,
  };
}
