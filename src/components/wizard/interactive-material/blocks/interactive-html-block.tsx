"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import { AlertTriangle, Info, Maximize2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@xue-learn/core/ui/dialog";
import { useT } from "@xue-learn/core/i18n";
import { isAdvancedHtmlDiagramsEnabled } from "@xue-learn/core/features";
import { isDesktopLocalRuntime } from "@xue-learn/core/client-runtime";
import type { InteractiveBlock } from "@xue-learn/core/schemas";
import { cn } from "@xue-learn/core/utils";

const MIN_FRAME_HEIGHT = 240;
const MAX_FRAME_HEIGHT = 960;
const DEFAULT_FRAME_HEIGHT = 360;

type InteractiveFrameMessage = {
  source?: unknown;
  type?: unknown;
  height?: unknown;
};

type DesktopHtmlPlayground = {
  register: (html: string) => Promise<{ documentId: string; src: string }>;
  release: (documentId: string) => Promise<void> | void;
};

function desktopHtmlPlayground() {
  if (typeof window === "undefined") return undefined;
  const runtimeWindow = window as typeof window & {
    xueLearnDesktop?: { htmlPlayground?: DesktopHtmlPlayground };
  };
  return runtimeWindow.xueLearnDesktop?.htmlPlayground;
}

function clampFrameHeight(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(
    MAX_FRAME_HEIGHT,
    Math.max(MIN_FRAME_HEIGHT, Math.ceil(value)),
  );
}

function HtmlIframe({
  html,
  frameSrc,
  title,
  className,
  style,
  iframeRef,
  onLoad,
}: {
  html: string;
  frameSrc: string | null;
  title: string;
  className?: string;
  style?: CSSProperties;
  iframeRef?: Ref<HTMLIFrameElement>;
  onLoad?: () => void;
}) {
  return (
    <iframe
      ref={iframeRef}
      title={title}
      sandbox="allow-scripts"
      src={frameSrc ?? undefined}
      srcDoc={frameSrc ? undefined : html}
      className={className}
      style={style}
      onLoad={onLoad}
      referrerPolicy="no-referrer"
    />
  );
}

export function InteractiveHtmlBlock({
  block,
  compact,
}: {
  block: Extract<InteractiveBlock, { type: "interactive_html" }>;
  compact?: boolean;
}) {
  const t = useT();
  const enabled = isAdvancedHtmlDiagramsEnabled(isDesktopLocalRuntime());
  const title = block.title || t("wizard.material.interactiveHtml.title");
  const baseHeight = clampFrameHeight(
    block.height ?? (compact ? 280 : DEFAULT_FRAME_HEIGHT),
    compact ? 280 : DEFAULT_FRAME_HEIGHT,
  );
  const html = useMemo(() => block.html, [block.html]);
  const playground = desktopHtmlPlayground();
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [frameHeight, setFrameHeight] = useState(baseHeight);
  const [frameReady, setFrameReady] = useState(false);
  const [frameError, setFrameError] = useState(false);
  const [runtimeWarning, setRuntimeWarning] = useState(false);
  const inlineFrameRef = useRef<HTMLIFrameElement | null>(null);
  const expandedFrameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setFrameSrc(null);
    setFrameHeight(baseHeight);
    setFrameReady(false);
    setFrameError(false);
    setRuntimeWarning(false);

    if (!enabled || !playground) return;

    let cancelled = false;
    let documentId: string | undefined;
    void playground
      .register(html)
      .then((registered) => {
        if (cancelled) {
          void playground.release(registered.documentId);
          return;
        }
        documentId = registered.documentId;
        setFrameSrc(registered.src);
      })
      .catch(() => {
        if (!cancelled) setFrameError(true);
      });

    return () => {
      cancelled = true;
      setFrameSrc(null);
      if (documentId) void playground.release(documentId);
    };
  }, [baseHeight, enabled, html, playground]);

  useEffect(() => {
    function handleFrameMessage(event: MessageEvent<InteractiveFrameMessage>) {
      const sourceMatches =
        event.source === inlineFrameRef.current?.contentWindow ||
        event.source === expandedFrameRef.current?.contentWindow;
      if (!sourceMatches || event.data?.source !== "xuelearn-html") return;

      if (event.data.type === "resize") {
        const nextHeight = Number(event.data.height);
        if (!Number.isFinite(nextHeight)) return;
        setFrameHeight((current) =>
          Math.max(current, clampFrameHeight(nextHeight, baseHeight)),
        );
      }
      if (event.data.type === "runtime-error") setRuntimeWarning(true);
    }

    window.addEventListener("message", handleFrameMessage);
    return () => window.removeEventListener("message", handleFrameMessage);
  }, [baseHeight]);

  if (!enabled) {
    return (
      <section
        className={cn(
          "rounded-2xl border border-[var(--course-content-border-accent)] bg-[var(--course-content-surface-muted)]",
          compact ? "p-3" : "p-4 sm:p-5",
        )}
      >
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--course-content-accent-soft)] text-[var(--course-content-accent)]">
            <Sparkles className="size-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h5 className="font-semibold text-[var(--course-content)]">
              {title}
            </h5>
            <p className="mt-1 text-sm leading-6 text-[var(--course-content-muted)]">
              {block.summary}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const renderError = () => (
    <div
      className="grid place-items-center rounded-xl border border-dashed border-[var(--course-content-border-accent)] bg-[var(--course-content-surface)] px-6 text-center"
      style={{ minHeight: baseHeight }}
      role="status"
    >
      <div className="max-w-sm">
        <AlertTriangle
          className="mx-auto size-7 text-[var(--course-content-accent)]"
          aria-hidden
        />
        <p className="mt-3 font-medium text-[var(--course-content)]">
          {t("wizard.material.interactiveHtml.loadFailed")}
        </p>
        <p className="mt-1 text-sm leading-6 text-[var(--course-content-muted)]">
          {block.summary}
        </p>
      </div>
    </div>
  );

  const renderIframe = (expanded: boolean) => {
    const frame = (
      <HtmlIframe
        html={html}
        frameSrc={frameSrc}
        title={title}
        iframeRef={expanded ? expandedFrameRef : inlineFrameRef}
        onLoad={() => setFrameReady(true)}
        className={cn(
          "block w-full bg-white",
          expanded ? "h-full border-0" : "rounded-xl border-0",
        )}
        style={{
          height: expanded ? "100%" : frameHeight,
          colorScheme: "light" as const,
          backgroundColor: "#f8fafc",
        }}
      />
    );

    if (expanded || frameReady) return frame;

    return (
      <div className="relative w-full" style={{ height: frameHeight }}>
        {frame}
        <div className="absolute inset-0 grid place-items-center bg-[#f8fafc]">
          <div className="flex items-center gap-2 rounded-full border border-[var(--course-content-border)] bg-white/90 px-3 py-2 text-sm text-[var(--course-content-muted)] shadow-sm">
            <span className="size-2 animate-pulse rounded-full bg-[var(--course-content-accent)]" />
            {t("wizard.material.interactiveHtml.loading")}
          </div>
        </div>
      </div>
    );
  };

  const renderStage = (expanded = false) => {
    if (frameError) return renderError();
    if (!expanded && playground && !frameSrc) {
      return (
        <div
          className="grid place-items-center rounded-xl bg-[#f8fafc]"
          style={{ minHeight: baseHeight }}
          role="status"
          aria-label={t("wizard.material.interactiveHtml.loading")}
        >
          <div className="flex items-center gap-2 rounded-full border border-[var(--course-content-border)] bg-white/90 px-3 py-2 text-sm text-[var(--course-content-muted)] shadow-sm">
            <span className="size-2 animate-pulse rounded-full bg-[var(--course-content-accent)]" />
            {t("wizard.material.interactiveHtml.loading")}
          </div>
        </div>
      );
    }
    return renderIframe(expanded);
  };

  return (
    <>
      <section
        className={cn(
          "overflow-hidden rounded-2xl bg-[var(--course-content-surface-muted)]",
          compact ? "p-1" : "p-1 sm:p-2",
        )}
        data-interactive-html-block
      >
        <header className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--course-content-muted)]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--course-content-accent-soft)] px-2.5 py-1 text-[var(--course-content-accent)]">
                <Sparkles className="size-3" aria-hidden />
                {t("wizard.material.interactiveHtml.badge")}
              </span>
              <span className="rounded-full border border-[var(--course-content-border)] px-2.5 py-1">
                {t("wizard.material.interactiveHtml.interactive")}
              </span>
            </div>
            <h5 className="text-lg font-semibold leading-tight tracking-[-0.01em] text-[var(--course-content)] sm:text-xl">
              {title}
            </h5>
          </div>
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--course-content-border)] bg-[var(--course-content-surface)] text-[var(--course-content-muted)] shadow-sm transition hover:-translate-y-0.5 hover:text-[var(--course-content)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--course-content-accent)] focus-visible:ring-offset-2"
            aria-label={t("wizard.material.interactiveHtml.fullscreen")}
            title={t("wizard.material.interactiveHtml.fullscreen")}
          >
            <Maximize2 className="size-4" aria-hidden />
          </button>
        </header>

        <div className="overflow-hidden rounded-xl border border-[var(--course-content-border)] bg-white shadow-[0_6px_18px_-16px_rgba(62,54,50,0.55)]">
          {renderStage()}
        </div>

        {runtimeWarning ? (
          <div
            className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--course-content-border-accent)] bg-[var(--course-content-accent-soft)] px-3 py-2 text-sm text-[var(--course-content-muted)]"
            role="status"
          >
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-[var(--course-content-accent)]"
              aria-hidden
            />
            <span>{t("wizard.material.interactiveHtml.runtimeWarning")}</span>
          </div>
        ) : null}

        {block.summary ? (
          <div className="mt-4 flex items-start gap-2.5 border-t border-[var(--course-content-border)] pt-3 text-sm leading-6 text-[var(--course-content-muted)]">
            <Info
              className="mt-1 size-4 shrink-0 text-[var(--course-content-accent)]"
              aria-hidden
            />
            <p>
              <span className="mr-1 font-semibold text-[var(--course-content)]">
                {t("wizard.material.interactiveHtml.observation")}:
              </span>
              {block.summary}
            </p>
          </div>
        ) : null}
      </section>

      <Dialog open={isExpanded} onOpenChange={setIsExpanded}>
        <DialogContent
          className="inset-0 flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none bg-[var(--course-content-surface-muted)] p-3 ring-0 sm:p-5 sm:max-w-none"
          showOverlay={false}
          closeButtonClassName="top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] z-10 bg-background/90 shadow-sm"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--course-content-border)] bg-white shadow-[0_18px_50px_-35px_rgba(62,54,50,0.6)]">
            <DialogHeader className="shrink-0 border-b border-border px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] pr-16 sm:px-6">
              <DialogTitle className="truncate text-base">{title}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("wizard.material.interactiveHtml.viewTools")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-[#f8fafc] p-0 sm:p-3">
              <div className="h-full w-full overflow-hidden rounded-xl bg-white">
                {renderStage(true)}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
