"use client";

import { useCallback, useEffect, useState } from "react";

export function useTypewriter(
  text: string,
  options?: {
    enabled?: boolean;
    charsPerTick?: number;
    msPerTick?: number;
    resetKey?: string | number;
  }
) {
  const enabled = options?.enabled ?? true;
  const charsPerTick = options?.charsPerTick ?? 2;
  const msPerTick = options?.msPerTick ?? 28;
  const resetKey = options?.resetKey ?? text;

  const [index, setIndex] = useState(enabled ? 0 : text.length);

  useEffect(() => {
    setIndex(enabled ? 0 : text.length);
  }, [resetKey, enabled, text.length]);

  const done = !enabled || index >= text.length;

  useEffect(() => {
    if (done) return;
    const id = window.setInterval(() => {
      setIndex((i) => Math.min(i + charsPerTick, text.length));
    }, msPerTick);
    return () => window.clearInterval(id);
  }, [done, text.length, charsPerTick, msPerTick]);

  const skip = useCallback(() => {
    setIndex(text.length);
  }, [text.length]);

  return {
    displayed: enabled ? text.slice(0, index) : text,
    done,
    skip,
  };
}
