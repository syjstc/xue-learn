"use client";
import { useT } from "../../shared/i18n/index.js";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Check, Copy, Play } from "lucide-react";
import { HighlightedCode } from "./highlighted-code.js";
import { resolveHighlightLanguage } from "./highlight.js";
import { useDomTextHighlights } from "./dom-text-highlights.js";
import type { TextHighlightSpan } from "../../shared/domain/material-highlight.js";
import { useDesktopPythonEditor } from "../desktop-python-editor/python-editor-provider.js";
import { isDesktopPythonPlaygroundEnabled } from "../../shared/features.js";
import { isDesktopLocalRuntime } from "../../shared/runtime/client-runtime.js";
import { cn, copyTextToClipboard } from "../../shared/utils.js";
import {
  codeBoardParts,
  isPlainCodeLanguage,
  materialCueCodeRegionLit,
  type MaterialCodePart,
} from "../../../libs/domain/src/index.js";

const COPY_NOTICE_MS = 1800;

const LANGUAGE_LABELS: Record<string, string> = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  diff: "Diff",
  dockerfile: "Dockerfile",
  go: "Go",
  graphql: "GraphQL",
  ini: "INI / TOML",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  lua: "Lua",
  makefile: "Makefile",
  markdown: "Markdown",
  objectivec: "Objective-C",
  perl: "Perl",
  php: "PHP",
  powershell: "PowerShell",
  python: "Python",
  r: "R",
  ruby: "Ruby",
  rust: "Rust",
  scala: "Scala",
  scss: "SCSS",
  sql: "SQL",
  swift: "Swift",
  typescript: "TypeScript",
  vbnet: "VB.NET",
  wasm: "WebAssembly",
  xml: "HTML",
  yaml: "YAML",
};

function formatLanguageLabel(language?: string): string {
  if (isPlainCodeLanguage(language)) return "Text";
  const resolved = resolveHighlightLanguage(language);
  if (!resolved) return "Code";
  return LANGUAGE_LABELS[resolved] ?? resolved.toUpperCase();
}

export function CodeBlockShell({
  code,
  language,
  className,
  contentKey,
  spans = [],
  onSpanClick,
  parts,
  activeTargetIds = [],
  figureId,
  presentation = "default",
}: {
  code: string;
  language?: string;
  className?: string;
  /** Follow-up highlight + selection region key, e.g. block:0:code:0 */
  contentKey?: string;
  spans?: TextHighlightSpan[];
  onSpanClick?: (aid: string, threadId?: string) => void;
  parts?: readonly MaterialCodePart[];
  activeTargetIds?: readonly string[];
  figureId?: string;
  presentation?: "default" | "chat";
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const pythonEditor = useDesktopPythonEditor();
  const canRunPython =
    isDesktopPythonPlaygroundEnabled(isDesktopLocalRuntime()) &&
    resolveHighlightLanguage(language) === "python" &&
    Boolean(pythonEditor);
  const useDomHighlights = Boolean(contentKey && spans.length > 0);
  const renderedCode = useMemo(() => code.replace(/\n$/, ""), [code]);
  const boardParts = useMemo(
    () => (parts?.length ? [...parts] : codeBoardParts({ code, parts })),
    [code, parts],
  );
  const litPartIds = useMemo(() => {
    return new Set(
      boardParts
        .map((part) => part.id)
        .filter((id): id is string => Boolean(id))
        .filter((id) =>
          materialCueCodeRegionLit(activeTargetIds, id, figureId),
        ),
    );
  }, [activeTargetIds, boardParts, figureId]);
  const cueParts = litPartIds.size > 0;
  const lineCount = useMemo(
    () => renderedCode.split("\n").length,
    [renderedCode],
  );
  const isChatText = presentation === "chat" && isPlainCodeLanguage(language);
  const showLineNumbers = lineCount > 1 && !isChatText;
  const languageLabel = formatLanguageLabel(language);

  useDomTextHighlights(preRef, spans, onSpanClick, useDomHighlights, [
    renderedCode,
    language,
  ]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const showNotice = (message: string) => {
    setNotice(message);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, COPY_NOTICE_MS);
  };

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const ok = await copyTextToClipboard(renderedCode);
    if (ok) {
      setCopied(true);
      showNotice(t("display.ui.copied"));
      window.setTimeout(() => setCopied(false), COPY_NOTICE_MS);
      return;
    }

    setCopied(false);
    showNotice(t("display.ui.couldNotCopy"));
  };

  return (
    <div
      data-highlight-exclude
      data-code-presentation={presentation}
      data-code-kind={isChatText ? "text" : "code"}
      className={cn(
        "group/code-block relative mt-3 overflow-hidden rounded-xl border border-[var(--course-content-code-border)] bg-[var(--course-content-code-bg)] shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--course-content-code-border)] bg-[var(--course-content-code-header-bg)] px-3 py-2">
        <span className="font-mono text-[11px] font-medium tracking-wide text-[var(--course-content-code-muted)] uppercase">
          {languageLabel}
        </span>
        <div className="flex items-center gap-1.5">
          {notice ? (
            <span
              role="status"
              aria-live="polite"
              className="rounded-md border border-[var(--course-content-code-border)] bg-[var(--course-content-code-bg)] px-2 py-0.5 text-[11px] text-[var(--course-content-code-text)]"
            >
              {notice}
            </span>
          ) : null}
          {canRunPython ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                pythonEditor?.openEditor(renderedCode, { run: true });
              }}
              aria-label={t("display.ui.run")}
              title={t("display.ui.run")}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--course-content-code-border)] bg-[var(--course-content-code-bg)] px-2 text-[11px] font-medium text-[var(--course-content-code-muted)] transition hover:border-[var(--course-content-code-muted)] hover:text-[var(--course-content-code-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Play className="size-3" aria-hidden />
              <span className="hidden sm:inline">{t("display.ui.run")}</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleCopy}
            aria-label={
              copied ? t("display.ui.copied") : t("display.ui.copyCode")
            }
            title={copied ? t("display.ui.copied") : t("display.ui.copyCode")}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--course-content-code-border)] bg-[var(--course-content-code-bg)] px-2 text-[11px] font-medium text-[var(--course-content-code-muted)] transition hover:border-[var(--course-content-code-muted)] hover:text-[var(--course-content-code-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {copied ? (
              <Check className="size-3" aria-hidden />
            ) : (
              <Copy className="size-3" aria-hidden />
            )}
            <span className="hidden sm:inline">
              {copied ? t("display.ui.copied") : t("display.ui.copy")}
            </span>
          </button>
        </div>
      </div>
      <div className="code-block-scroll flex overflow-x-auto">
        {showLineNumbers ? (
          <div
            className="shrink-0 select-none border-r border-[var(--course-content-code-border)] bg-[var(--course-content-code-gutter-bg)] px-3 py-3 text-right font-mono text-[13px] leading-[1.625] text-[var(--course-content-code-gutter-text)]"
            aria-hidden
          >
            {Array.from({ length: lineCount }, (_, index) => (
              <div key={index}>{index + 1}</div>
            ))}
          </div>
        ) : null}
        <pre
          ref={preRef}
          data-code-block={contentKey ? "" : undefined}
          data-content-key={contentKey}
          data-selectable-text={contentKey ? "" : undefined}
          className={cn(
            "code-block-shell min-w-0 flex-1 select-text px-4 py-3 font-mono text-[13px] leading-[1.625] text-[var(--course-content-code-text)]",
            showLineNumbers
              ? "whitespace-pre"
              : "break-words whitespace-pre-wrap",
          )}
        >
          {cueParts ? (
            <code className="hljs block font-mono text-[13px] leading-[1.625]">
              {boardParts.map((part, index) => {
                const lit = Boolean(part.id && litPartIds.has(part.id));
                return (
                  <span
                    key={`${part.id ?? "ctx"}:${index}`}
                    className={cn(
                      "code-block-part",
                      lit && "is-cued",
                      !lit && "is-dim",
                    )}
                  >
                    <HighlightedCode
                      as="span"
                      code={part.text}
                      language={language}
                    />
                  </span>
                );
              })}
            </code>
          ) : (
            <HighlightedCode
              code={renderedCode}
              language={language}
              className="text-[13px] leading-[1.625]"
            />
          )}
        </pre>
      </div>
    </div>
  );
}
