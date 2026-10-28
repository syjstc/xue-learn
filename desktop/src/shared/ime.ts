import type { KeyboardEvent as ReactKeyboardEvent } from "react";

type NativeKeyboardEvent = KeyboardEvent | ReactKeyboardEvent["nativeEvent"];

/** True while an IME composition is active (e.g. confirming Pinyin with Enter). */
export function isImeComposingFromEvent(
  event: KeyboardEvent | ReactKeyboardEvent,
): boolean {
  const native: NativeKeyboardEvent =
    "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}

/** True when Enter should run app logic — not while IME is confirming input. */
export function isEnterWithoutIme(
  event: KeyboardEvent | ReactKeyboardEvent,
  composing = false,
): boolean {
  return (
    event.key === "Enter" &&
    !composing &&
    !isImeComposingFromEvent(event)
  );
}

/** Block implicit form submit on Enter during IME composition. */
export function preventImeEnterSubmit(
  event: ReactKeyboardEvent,
  composing = false,
): void {
  if (event.key === "Enter" && (composing || isImeComposingFromEvent(event))) {
    event.preventDefault();
  }
}

/** Wrap an Enter keydown handler so it ignores IME confirmation keys. */
export function onEnterWithoutIme(
  handler: (event: ReactKeyboardEvent) => void,
  isComposing: () => boolean = () => false,
): (event: ReactKeyboardEvent) => void {
  return (event) => {
    if (!isEnterWithoutIme(event, isComposing())) return;
    handler(event);
  };
}
