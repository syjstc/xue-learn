"use client";

import { useState } from "react";
import { ChevronRight, Terminal } from "lucide-react";
import {
  formatPythonAskAiPreview,
  type PythonAskAiPayload,
} from "@/components/desktop-python-editor/ask-ai";
import { cn } from "@xue-learn/core/utils";
import { useT } from "@xue-learn/core/i18n";

export function PythonAskAiUserMessage({
  payload,
}: {
  payload: PythonAskAiPayload;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const preview = formatPythonAskAiPreview(payload);

  return (
    <div className="w-[min(100%,20rem)]">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
          aria-hidden
        />
        <Terminal className="size-3.5 shrink-0 opacity-80" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
          {t("pythonEditor.askAiCard")}
        </span>
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <section>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-primary-foreground/65">
              {t("pythonEditor.askAiCode")}
            </p>
            <pre className="max-h-32 overflow-auto rounded-lg bg-primary-foreground/10 px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {payload.code}
            </pre>
          </section>
          <section>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-primary-foreground/65">
              {t("pythonEditor.console")}
            </p>
            <pre className="max-h-32 overflow-auto rounded-lg bg-primary-foreground/10 px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {payload.output}
            </pre>
          </section>
        </div>
      ) : (
        <p className="mt-1 line-clamp-1 pl-[22px] text-[10px] leading-4 text-primary-foreground/70">
          {preview}
        </p>
      )}
    </div>
  );
}
