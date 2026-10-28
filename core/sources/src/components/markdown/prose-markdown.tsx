"use client";

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";
import { CodeBlockShell } from "./code-block-shell.js";
import { GraphFromMarkdown } from "../wizard/graph-block.js";
import { MathLatex } from "./math-latex.js";
import type { TextHighlightSpan } from "../../shared/domain/material-highlight.js";
import { isGraphFenceLanguage } from "../../shared/domain/graph.js";
import { cn } from "../../shared/utils.js";
import type { TextIndexState } from "./apply-text-highlights.js";
import { highlightMapStructureKey } from "./dom-text-highlights.js";
import { rehypeTextHighlights } from "./rehype-text-highlights.js";
import {
  normalizeEscapedMarkdownNewlines,
  normalizeHtmlLineBreaks,
} from "../../../libs/common/src/normalize-html-line-breaks.js";
import { normalizeLatexMathDelimiters } from "../../shared/markdown/normalize-latex-math.js";
import { renderPronunciationRuby } from "./pronunciation-ruby.js";

/**
 * Parent markdown nodes already walk nested nodes while expanding
 * pronunciation ruby. Do not expand the same text again in child renderers.
 */
const MarkdownDecoratedContext = createContext(false);

/**
 * Fenced ``` blocks always wrap `code` in `pre`. react-markdown no longer
 * passes `inline`, and "has a language class or newline" wrongly demotes
 * single-line unlabeled fences to inline chips — dropping block chrome and
 * making short error/keyword fences look empty.
 */
const MarkdownFencedCodeContext = createContext(false);

export type MarkdownCodeBlockContext = {
  contentKeyPrefix?: string;
  highlightSpansByKey?: Map<string, TextHighlightSpan[]>;
  onSpanClick?: (aid: string, threadId?: string) => void;
  nextCodeBlockIndex?: { current: number };
};

function decorateMarkdownChildren(
  children: ReactNode,
  keyPrefix: string,
): ReactNode {
  return renderPronunciationRuby(children, keyPrefix);
}

// Hoisted to module scope so the plugin arrays aren't re-allocated on every
// render — matters during typewriter animation, where content changes on each
// tick. remark-math turns $...$ / $$...$$ into `code.language-math` nodes;
// the `code` renderer below paints them with MathLatex (shared katex + mhchem).
// Do not use rehype-katex here: it depends on katex@0.16 and misses our mhchem
// side-effect on katex@0.17, so $\ce{...}$ shows as red raw TeX.
// A single `~` is commonly used in generated Chinese copy for numeric ranges
// (for example, `1~2 个 Token`). GFM's permissive default pairs those tildes
// across otherwise unrelated text and renders the whole span as deleted.
// Require the standard double-tilde form for intentional strikethrough.
const REMARK_PLUGINS: PluggableList = [
  [remarkGfm, { singleTilde: false }],
  remarkMath,
];
const REHYPE_PLUGINS: PluggableList = [];

function markdownCodeText(children: ReactNode): string {
  return String(children).replace(/\n$/, "");
}

const LATEX_COMMAND_RE = /\\[a-zA-Z]+/;

/** Recover LaTeX when an LLM stuffed math into a code span/fence. */
function mathLatexFromMarkdownCode(
  language: string | undefined,
  code: string,
): string | null {
  const lang = language?.trim().toLowerCase();
  if (lang === "math" || lang === "latex" || lang === "tex") {
    const trimmed = code.trim();
    const prefixed = trimmed.match(/^math(?:\s+|\s*\n+)([\s\S]+)$/i);
    if (prefixed) {
      const latex = prefixed[1]?.trim() ?? "";
      return LATEX_COMMAND_RE.test(latex) ? latex : trimmed;
    }
    return code;
  }

  const trimmed = code.trim();
  if (!trimmed) return null;

  const prefixed = trimmed.match(/^math(?:\s+|\s*\n+)([\s\S]+)$/i);
  if (prefixed) {
    const latex = prefixed[1]?.trim() ?? "";
    return LATEX_COMMAND_RE.test(latex) ? latex : null;
  }

  if (
    !lang &&
    /^\\begin\{[a-zA-Z*]+\}/.test(trimmed) &&
    /\\end\{[a-zA-Z*]+\}\s*$/.test(trimmed)
  ) {
    return trimmed;
  }

  return null;
}

function prepareMarkdownContent(content: string): string {
  return normalizeLatexMathDelimiters(
    normalizeHtmlLineBreaks(normalizeEscapedMarkdownNewlines(content)),
  );
}

export type ProseMarkdownVariant = "default" | "compact" | "muted" | "inline" | "board";

export function proseMarkdownClassName(
  variant: ProseMarkdownVariant = "default",
): string {
  switch (variant) {
    case "board":
      return "max-w-full break-words text-inherit leading-[inherit] [&>:first-child]:mt-0 [&>:last-child]:mb-0";
    case "compact":
      return "max-w-full break-words text-sm leading-relaxed text-[var(--course-content)] [&>:first-child]:mt-0 [&>:last-child]:mb-0";
    case "muted":
      return "max-w-full break-words text-base leading-relaxed text-[var(--course-content-muted)] [&>:first-child]:mt-0 [&>:last-child]:mb-0";
    case "inline":
      // Keep the wrapper inline so numbered/mixed rows (e.g. "1. …") stay on one line.
      return "inline max-w-full break-words text-inherit leading-relaxed [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_p]:inline [&_p]:not-first:before:content-['_']";
    default:
      return "max-w-full break-words text-base leading-relaxed text-[var(--course-content)] [&>:first-child]:mt-0 [&>:last-child]:mb-0";
  }
}

export function createMarkdownComponents(
  variant: ProseMarkdownVariant = "default",
  onInternalLinkClick?: () => void,
  codeBlocks?: MarkdownCodeBlockContext,
): Components {
  const compact = variant === "compact" || variant === "board";
  const inline = variant === "inline";
  const linkClassName =
    "font-medium text-[var(--course-content-link)] underline decoration-[var(--course-content-link-decoration)] underline-offset-2 transition-colors hover:text-[var(--course-content-link-hover)]";

  function Decorated({
    children,
    keyPrefix,
    as: tag,
    className,
    ...rest
  }: {
    children?: ReactNode;
    keyPrefix: string;
    as: string;
    className?: string;
  } & Record<string, unknown>) {
    const alreadyDecorated = useContext(MarkdownDecoratedContext);
    const content = alreadyDecorated
      ? children
      : decorateMarkdownChildren(children, keyPrefix);
    return (
      <MarkdownDecoratedContext.Provider value={true}>
        {createElement(tag, { className, ...rest }, content)}
      </MarkdownDecoratedContext.Provider>
    );
  }

  function MarkdownAnchor({
    href,
    children,
  }: {
    href?: string;
    children?: ReactNode;
  }) {
    const alreadyDecorated = useContext(MarkdownDecoratedContext);
    const keyPrefix = href?.startsWith("/") ? "a-internal" : "a";
    const content = alreadyDecorated
      ? children
      : decorateMarkdownChildren(children, keyPrefix);

    if (href?.startsWith("/")) {
      return (
        <MarkdownDecoratedContext.Provider value={true}>
          <Link
            to={href}
            className={linkClassName}
            onClick={() => onInternalLinkClick?.()}
          >
            {content}
          </Link>
        </MarkdownDecoratedContext.Provider>
      );
    }

    return (
      <MarkdownDecoratedContext.Provider value={true}>
        <a
          href={href}
          className={linkClassName}
          target="_blank"
          rel="noopener noreferrer"
        >
          {content}
        </a>
      </MarkdownDecoratedContext.Provider>
    );
  }

  return {
    p: variant === "board"
      ? ({ children }) => (
          <p className="lp-text-board-paragraph">
            <Decorated as="span" keyPrefix="p-board" className="lp-text-board-ink">
              {children}
            </Decorated>
          </p>
        )
      : inline
      ? ({ children }) => (
          <Decorated as="span" keyPrefix="p-inline" className="leading-relaxed">
            {children}
          </Decorated>
        )
      : ({ children }) => (
          <Decorated
            as="p"
            keyPrefix="p"
            className="leading-relaxed not-first:mt-2"
          >
            {children}
          </Decorated>
        ),
    ul: ({ children }) => (
      <ul
        className={cn(
          "list-disc space-y-1 pl-5",
          variant === "board"
            ? "mt-2 text-inherit"
            : compact
              ? "mt-1.5 text-sm"
              : "mt-2",
        )}
      >
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol
        className={cn(
          "list-decimal space-y-1 pl-5",
          variant === "board"
            ? "mt-2 text-inherit"
            : compact
              ? "mt-1.5 text-sm"
              : "mt-2",
        )}
      >
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <Decorated as="li" keyPrefix="li" className="leading-relaxed">
        {children}
      </Decorated>
    ),
    strong: ({ children }) => (
      <Decorated
        as="strong"
        keyPrefix="strong"
        className="font-semibold text-[var(--course-content)]"
      >
        {children}
      </Decorated>
    ),
    em: ({ children }) => (
      <Decorated
        as="em"
        keyPrefix="em"
        className="italic text-[var(--course-content)]"
      >
        {children}
      </Decorated>
    ),
    a: MarkdownAnchor,
    code: function MarkdownCode({ className, children }) {
      const fenced = useContext(MarkdownFencedCodeContext);
      const code = markdownCodeText(children);
      const language = /language-([\w+#-]+)/i.exec(className ?? "")?.[1];
      const isMathInline = /\bmath-inline\b/.test(className ?? "");
      const isMathDisplay = /\bmath-display\b/.test(className ?? "");
      // Prefer the pre wrapper over heuristics — unlabeled single-line fences
      // are still blocks (common for error keywords / short terminal output).
      const isBlock = fenced || Boolean(language) || code.includes("\n");
      const mathLatex = mathLatexFromMarkdownCode(language, code);

      // remark-math emits language-math (+ math-inline / math-display). Also
      // covers leftover ```math / latex fences and math-disguised code.
      if (mathLatex != null) {
        const display = isMathInline
          ? false
          : isMathDisplay ||
            isBlock ||
            /\\begin\{/.test(mathLatex) ||
            mathLatex.includes("\n") ||
            mathLatex.length > 60;
        return (
          <MathLatex
            latex={mathLatex}
            display={display}
            fitToContainer={variant === "board"}
            className={
              variant === "board"
                ? display
                  ? "katex-display"
                  : "katex-inline"
                : undefined
            }
          />
        );
      }

      if (isBlock && isGraphFenceLanguage(language, code)) {
        return <GraphFromMarkdown code={code} />;
      }

      if (isBlock) {
        const codeBlockIndex = codeBlocks?.nextCodeBlockIndex?.current ?? 0;
        if (codeBlocks?.nextCodeBlockIndex) {
          codeBlocks.nextCodeBlockIndex.current += 1;
        }
        const contentKey = codeBlocks?.contentKeyPrefix
          ? `${codeBlocks.contentKeyPrefix}:code:${codeBlockIndex}`
          : undefined;
        const spans = contentKey
          ? codeBlocks?.highlightSpansByKey?.get(contentKey)
          : undefined;
        return (
          <CodeBlockShell
            code={code}
            language={language}
            contentKey={contentKey}
            spans={spans}
            onSpanClick={codeBlocks?.onSpanClick}
          />
        );
      }

      return (
        <code className="rounded bg-[var(--course-content-surface-muted)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--course-content)]">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <MarkdownFencedCodeContext.Provider value={true}>
        {children}
      </MarkdownFencedCodeContext.Provider>
    ),
    blockquote: ({ children }) => (
      <Decorated
        as="blockquote"
        keyPrefix="blockquote"
        className="mt-2 border-l-[3px] border-[var(--course-content-border-accent)] bg-[var(--course-content-surface-accent)] py-0.5 pl-3 text-[var(--course-content)] not-italic"
      >
        {children}
      </Decorated>
    ),
    h1: ({ children }) => (
      <Decorated
        as="h1"
        keyPrefix="h1"
        className={cn(
          "font-semibold text-[var(--course-content)]",
          compact ? "mt-2 text-base" : "mt-4 text-lg",
        )}
      >
        {children}
      </Decorated>
    ),
    h2: ({ children }) => (
      <Decorated
        as="h2"
        keyPrefix="h2"
        className={cn(
          "font-semibold text-[var(--course-content)]",
          compact ? "mt-2 text-sm" : "mt-3 text-base",
        )}
      >
        {children}
      </Decorated>
    ),
    h3: ({ children }) => (
      <Decorated
        as="h3"
        keyPrefix="h3"
        className={cn(
          "font-medium text-[var(--course-content)]",
          compact ? "mt-1.5 text-sm" : "mt-2 text-base",
        )}
      >
        {children}
      </Decorated>
    ),
    hr: () => <hr className="my-3 border-[var(--course-content-border)]" />,
    table: ({ children }) => (
      <div className="mt-2 max-w-full overflow-x-auto rounded-lg border border-[var(--course-content-border)]">
        <table className="min-w-full border-collapse text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-[var(--course-content-surface-muted)]">
        {children}
      </thead>
    ),
    th: ({ children }) => (
      <Decorated
        as="th"
        keyPrefix="th"
        className="border-b border-[var(--course-content-border)] px-2.5 py-1.5 text-left font-medium text-[var(--course-content)]"
      >
        {children}
      </Decorated>
    ),
    td: ({ children }) => (
      <Decorated
        as="td"
        keyPrefix="td"
        className="border-b border-[var(--course-content-border)] px-2.5 py-1.5 text-[var(--course-content)]"
      >
        {children}
      </Decorated>
    ),
  };
}

const COMPONENTS_BY_VARIANT: Record<ProseMarkdownVariant, Components> = {
  board: createMarkdownComponents("board"),
  default: createMarkdownComponents("default"),
  compact: createMarkdownComponents("compact"),
  muted: createMarkdownComponents("muted"),
  inline: createMarkdownComponents("inline"),
};

/**
 * GFM markdown for lesson content, study notes, and chat.
 * Use {@link RichText} when inline citations or follow-up highlights are needed.
 */
export function ProseMarkdown({
  content,
  className,
  variant = "default",
  onInternalLinkClick,
  spans = [],
  onSpanClick,
  highlightState,
  contentKeyPrefix,
  highlightSpansByKey,
}: {
  content: string;
  className?: string;
  variant?: ProseMarkdownVariant;
  onInternalLinkClick?: () => void;
  spans?: TextHighlightSpan[];
  onSpanClick?: (aid: string, threadId?: string) => void;
  /** Shared across sibling markdown chunks (e.g. citation segments). */
  highlightState?: TextIndexState;
  /** Prefix for nested follow-up regions, e.g. block:0 → block:0:code:0 */
  contentKeyPrefix?: string;
  highlightSpansByKey?: Map<string, TextHighlightSpan[]>;
}) {
  const parsedContent = useMemo(
    () => prepareMarkdownContent(content),
    [content],
  );
  const localHighlightState = useMemo(
    () => ({ index: 0 }),
    [parsedContent, spans],
  );
  const activeHighlightState = highlightState ?? localHighlightState;
  if (!highlightState) {
    activeHighlightState.index = 0;
  }
  const codeBlockIndexRef = useRef({ current: 0 });
  codeBlockIndexRef.current.current = 0;

  const rehypePlugins = useMemo<PluggableList>(() => {
    if (!spans.length) return REHYPE_PLUGINS;
    return [
      ...REHYPE_PLUGINS,
      [
        rehypeTextHighlights,
        {
          spans,
          startIndex: activeHighlightState.index,
          onComplete: (endIndex: number) => {
            activeHighlightState.index = endIndex;
          },
        },
      ],
    ];
  }, [spans, activeHighlightState]);

  // Ignore Map identity / active-flag churn — those must not recreate
  // react-markdown `components` or reconciliation fights DOM highlights.
  const highlightMapKey = highlightMapStructureKey(highlightSpansByKey);
  const highlightMapRef = useRef(highlightSpansByKey);
  highlightMapRef.current = highlightSpansByKey;

  const codeBlockContext = useMemo((): MarkdownCodeBlockContext | undefined => {
    if (!contentKeyPrefix) return undefined;
    return {
      contentKeyPrefix,
      get highlightSpansByKey() {
        return highlightMapRef.current;
      },
      onSpanClick,
      nextCodeBlockIndex: codeBlockIndexRef.current,
    };
    // highlightMapKey tracks span structure; active-only updates use the getter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKeyPrefix, highlightMapKey, onSpanClick]);

  const components = useMemo(() => {
    if (onInternalLinkClick || codeBlockContext) {
      return createMarkdownComponents(
        variant,
        onInternalLinkClick,
        codeBlockContext,
      );
    }
    return COMPONENTS_BY_VARIANT[variant];
  }, [variant, onInternalLinkClick, codeBlockContext]);

  const handleHighlightClick = (event: MouseEvent<HTMLElement>) => {
    if (!onSpanClick) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const mark = target.closest("[data-highlight-aid]");
    if (!(mark instanceof HTMLElement)) return;
    if (mark.closest("[data-highlight-exclude]")) return;
    event.preventDefault();
    event.stopPropagation();
    const aid = mark.dataset.highlightAid;
    if (aid) onSpanClick(aid, mark.dataset.highlightThreadId);
  };

  if (!parsedContent.trim()) return null;

  const classNameCombined = cn(proseMarkdownClassName(variant), className);
  const markdown = (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {parsedContent}
    </ReactMarkdown>
  );

  // Inline variant must not use a block wrapper — otherwise siblings like
  // list indices ("1.") wrap onto their own line before the markdown text.
  if (variant === "inline") {
    return (
      <span className={classNameCombined} onClick={handleHighlightClick}>
        {markdown}
      </span>
    );
  }

  return (
    <div className={classNameCombined} onClick={handleHighlightClick}>
      {markdown}
    </div>
  );
}
