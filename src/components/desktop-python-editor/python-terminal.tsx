"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { pythonConsoleStreamClass } from "@/components/desktop-python-editor/python-console";
import type { PythonConsoleLine } from "@xue-learn/core/components/desktop-python-editor/python-runtime";
import { cn } from "@xue-learn/core/utils";

export function DesktopPythonTerminal({
  lines,
  awaitingInput,
  emptyLabel,
  inputPlaceholder,
  clearLabel,
  title,
  onClear,
  onSubmitInput,
}: {
  lines: readonly PythonConsoleLine[];
  awaitingInput: boolean;
  emptyLabel: string;
  inputPlaceholder: string;
  clearLabel: string;
  title: string;
  onClear: () => void;
  onSubmitInput: (line: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [lines, awaitingInput, draft]);

  useEffect(() => {
    if (!awaitingInput) return;
    inputRef.current?.focus();
  }, [awaitingInput]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!awaitingInput) return;
    onSubmitInput(draft);
    setDraft("");
  };

  return (
    <div className="flex min-h-[30%] shrink-0 flex-col border-t border-[var(--course-content-code-border)] bg-[var(--course-content-code-bg)]">
      <div className="flex items-center justify-between px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-[var(--course-content-code-muted)]">
        <span className="flex items-center gap-2 normal-case">
          <span
            className={cn(
              "size-1.5 rounded-full",
              awaitingInput
                ? "bg-[var(--course-content-code-syntax-string)]"
                : "bg-[var(--course-content-code-gutter-text)]",
            )}
            aria-hidden
          />
          {title}
        </span>
        {lines.length > 0 ? (
          <button
            type="button"
            className="normal-case tracking-normal hover:text-[var(--course-content-code-text)]"
            onClick={onClear}
          >
            {clearLabel}
          </button>
        ) : null}
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto px-3 pb-3 font-mono text-[12px] leading-relaxed"
        onClick={() => awaitingInput && inputRef.current?.focus()}
      >
        {lines.length === 0 && !awaitingInput ? (
          <p className="text-[var(--course-content-code-muted)]">{emptyLabel}</p>
        ) : (
          lines.map((line, index) => (
            <span key={`${index}:${line.stream}`} className={pythonConsoleStreamClass(line.stream)}>
              {line.text}
            </span>
          ))
        )}
        {awaitingInput ? (
          <form className="flex items-center gap-2" onSubmit={submit}>
            <span className="text-[var(--course-content-code-syntax-string)]" aria-hidden>
              ❯
            </span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[var(--course-content-code-text)] outline-none placeholder:text-[var(--course-content-code-gutter-text)]"
              placeholder={inputPlaceholder}
              autoComplete="off"
              spellCheck={false}
              aria-label={inputPlaceholder}
            />
          </form>
        ) : null}
      </div>
    </div>
  );
}
