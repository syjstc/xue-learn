import type { FormHTMLAttributes } from "react";
import { useImeComposition } from "@/hooks/use-ime-composition";

/** Form wrapper that ignores Enter during IME composition (prevents accidental submit). */
export function ImeSafeForm({
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  ...props
}: FormHTMLAttributes<HTMLFormElement>) {
  const { formProps } = useImeComposition();

  return (
    <form
      {...props}
      onCompositionStart={(event) => {
        formProps.onCompositionStart?.(event);
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        formProps.onCompositionEnd?.(event);
        onCompositionEnd?.(event);
      }}
      onKeyDown={(event) => {
        formProps.onKeyDown?.(event);
        onKeyDown?.(event);
      }}
    />
  );
}
