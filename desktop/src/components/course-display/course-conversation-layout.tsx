import type { FollowUpMessage } from "@xue-learn/core/shared/domain/material-anchor";
import { MarkdownContent } from "@/components/ui/markdown-content";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@xue-learn/core/ui/sheet";
import { useI18n } from "@xue-learn/core/i18n";
import { ArrowUp, Columns2, Maximize2, Minimize2, Rows2, Square, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import "./course-conversation-layout.css";

type PresentationLayout = "split" | "subtitles";
const LAYOUT_STORAGE_KEY = "xue-learn.learningDisplay.layout";
const layoutMessages = {
  "zh-Hans": { label: "演示布局", split: "左右布局", subtitles: "上下布局" },
  "zh-Hant": { label: "演示佈局", split: "左右佈局", subtitles: "上下佈局" },
  en: { label: "Presentation layout", split: "Side by side", subtitles: "Top and bottom" },
};

export function CourseConversationLayout({
  identity,
  topicIdentity,
  narrationIdentity,
  heading,
  display,
  persona,
  children,
  chat,
  controls,
}: {
  identity: string;
  topicIdentity?: string;
  narrationIdentity?: number;
  heading?: ReactNode;
  display?: ReactNode;
  persona: { name: string; avatarSrc: string };
  children: ReactNode;
  controls?: ReactNode;
  chat?: {
    messages: FollowUpMessage[];
    activeDiscussionId?: string;
    sending: boolean;
    error: string;
    selection?: { text: string; nonce: number };
    onClearSelection: () => void;
    onStop: () => void;
    onSend: (message: string) => Promise<boolean>;
  };
}) {
  const { t, locale } = useI18n();
  const labels = layoutMessages[locale];
  const [layout, setLayout] = useState<PresentationLayout>(() => {
    try { return localStorage.getItem(LAYOUT_STORAGE_KEY) === "subtitles" ? "subtitles" : "split"; }
    catch { return "split"; }
  });
  const chooseLayout = (next: PresentationLayout) => {
    setLayout(next);
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, next); }
    catch { /* The current layout remains usable without persistent storage. */ }
  };
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const mobileComposer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const mobileThread = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = board.current?.querySelector<HTMLElement>(
      `[data-course-display-key="${CSS.escape(identity)}"]`,
    );
    if (!target || !board.current) return;
    // The host reveals the exact cue inside a composition. A competing scroll
    // to the group's top would undo that focus.
    if (target.querySelector('[data-focused="true"], [data-lp-lit="true"]')) return;
    const root = board.current;
    root.scrollTo({
      top:
        root.scrollTop +
        target.getBoundingClientRect().top -
        root.getBoundingClientRect().top,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [identity, layout]);
  useEffect(() => {
    const root = board.current;
    if (!root) return;
    const measure = () => {
      const minimum = layout === "subtitles" && window.matchMedia("(min-width: 701px)").matches ? 1 : 280;
      root.style.setProperty(
        "--course-board-height",
        `${Math.max(minimum, root.clientHeight - 16)}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [layout]);
  const following = useRef(true);
  const submitting = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const expandButton = useRef<HTMLButtonElement>(null);
  const hasDisplay = Boolean(display);
  const subtitles = layout === "subtitles" && hasDisplay;

  useEffect(() => {
    const root = transcript.current;
    if (!root || !subtitles) return;
    // Keep the live line in the short caption strip as speech reveals text.
    const followCaption = () => {
      if (following.current) root.scrollTop = root.scrollHeight;
    };
    following.current = true;
    root.scrollTop = 0;
    const observer = new MutationObserver(followCaption);
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [subtitles, narrationIdentity]);

  useEffect(() => {
    following.current = true;
    setExpanded(false);
    setAskOpen(false);
    if (transcript.current) transcript.current.scrollTop = 0;
  }, [topicIdentity ?? identity]);
  useEffect(() => {
    if (following.current && transcript.current && chat?.messages.length) {
      const root = transcript.current;
      const target = chat.activeDiscussionId
        ? root.querySelector<HTMLElement>(
            `[data-course-discussion="${CSS.escape(chat.activeDiscussionId)}"]`,
          )
        : null;
      if (target instanceof HTMLDetailsElement) target.open = true;
      root.scrollTop = target
        ? root.scrollTop +
          target.getBoundingClientRect().bottom -
          root.getBoundingClientRect().bottom +
          16
        : root.scrollHeight;
    }
  }, [chat?.messages, chat?.activeDiscussionId]);
  useEffect(() => {
    if (!chat?.selection) return;
    if (subtitles || window.matchMedia?.("(max-width: 700px)").matches) {
      setAskOpen(true);
    } else {
      composer.current?.focus({ preventScroll: true });
    }
  }, [chat?.selection?.nonce, subtitles]);
  useEffect(() => {
    if (!askOpen) return;
    const frame = requestAnimationFrame(() =>
      mobileComposer.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [askOpen]);
  useEffect(() => {
    if (askOpen && mobileThread.current) {
      mobileThread.current.scrollTop = mobileThread.current.scrollHeight;
    }
  }, [askOpen, chat?.messages]);
  useEffect(() => {
    if (!askOpen || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const update = () =>
      setKeyboardInset(
        Math.max(
          0,
          Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
        ),
      );
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      setKeyboardInset(0);
    };
  }, [askOpen]);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
        expandButton.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);

  const renderComposer = (mobile: boolean) =>
    chat ? (
      <form
        className="course-conversation-composer"
        data-course-chat
        onSubmit={async (event) => {
          event.preventDefault();
          const message = draft.trim();
          if (!message || chat.sending || submitting.current) return;
          submitting.current = true;
          setDraft("");
          following.current = true;
          try {
            const sent = await chat.onSend(message);
            if (!sent) setDraft((current) => current || message);
          } finally {
            submitting.current = false;
          }
        }}
      >
        {chat.error ? <p role="alert">{chat.error}</p> : null}
        {chat.selection ? (
          <div className="course-conversation-quote">
            <span>
              {chat.selection.text || t("learningDisplay.resumeDiscussion")}
            </span>
            <button
              type="button"
              onClick={chat.onClearSelection}
              aria-label={t("learningDisplay.clearQuote")}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
        <label
          className="sr-only"
          htmlFor={`${inputId}-${mobile ? "mobile" : "desktop"}`}
        >
          {t("learningDisplay.ask")}
        </label>
        <textarea
          id={`${inputId}-${mobile ? "mobile" : "desktop"}`}
          ref={mobile ? mobileComposer : composer}
          value={draft}
          rows={mobile ? 3 : 2}
          placeholder={t("learningDisplay.ask")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {chat.sending ? (
          <button
            type="button"
            className="course-conversation-send"
            onClick={chat.onStop}
            aria-label={t("learningDisplay.stop")}
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            className="course-conversation-send"
            disabled={!draft.trim()}
            aria-label={t("learningDisplay.send")}
          >
            <ArrowUp size={18} />
          </button>
        )}
      </form>
    ) : null;

  return (
    <section
      className="course-conversation"
      data-has-footer={controls || chat ? "true" : undefined}
      data-layout={layout}
    >
      <div
        className="course-conversation-frame"
        data-expanded={expanded || undefined}
      >
        <div className="course-conversation-header">
          <div className="course-conversation-heading">
            {heading ?? <span>{t("learningDisplay.lesson")}</span>}
          </div>
          <div className="course-conversation-layout-switch" role="group" aria-label={labels.label}>
            <button type="button" aria-pressed={layout === "split"} onClick={() => chooseLayout("split")}>
              <Columns2 size={16} aria-hidden /><span>{labels.split}</span>
            </button>
            <button type="button" aria-pressed={layout === "subtitles"} onClick={() => chooseLayout("subtitles")}>
              <Rows2 size={16} aria-hidden /><span>{labels.subtitles}</span>
            </button>
          </div>
        </div>
        <div
          className="course-conversation-panes"
          data-has-display={hasDisplay}
          data-layout={layout}
        >
          {/* Keep the lane mounted so changing from prose to a display can interpolate. */}
          <div
            className="course-conversation-display"
            aria-hidden={!hasDisplay}
            inert={!hasDisplay}
          >
            <div className="course-conversation-display-tools">
              <button
                ref={expandButton}
                type="button"
                aria-expanded={expanded}
                aria-label={t(
                  expanded
                    ? "learningDisplay.collapse"
                    : "learningDisplay.expand",
                )}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                <span className="course-conversation-display-tool-label">
                  {t(
                    expanded
                      ? "learningDisplay.collapse"
                      : "learningDisplay.expand",
                  )}
                </span>
              </button>
            </div>
            <div className="course-conversation-board" ref={board}>
              <div className="course-conversation-board-content">{display}</div>
            </div>
          </div>
          <div className="course-conversation-narration" data-course-chat>
            <div className="course-conversation-teacher">
              <img src={persona.avatarSrc} alt="" />
              <span>{persona.name}</span>
            </div>
            <div
              className="course-conversation-transcript"
              ref={transcript}
              tabIndex={0}
              onScroll={() => {
                const el = transcript.current;
                if (el)
                  following.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              {children}
            </div>
            {renderComposer(false)}
          </div>
        </div>
        {controls || chat ? (
          <div
            className="course-conversation-controls"
            data-has-chat={chat ? "true" : undefined}
            data-has-controls={controls ? "true" : undefined}
          >
            {chat ? (
              <button
                type="button"
                className="course-conversation-mobile-ask"
                onClick={() => setAskOpen(true)}
              >
                {t("learningDisplay.askTeacher")}
              </button>
            ) : null}
            {controls}
          </div>
        ) : null}
      </div>
      {chat ? (
        <Sheet open={askOpen} onOpenChange={setAskOpen}>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            className="course-conversation-ask-sheet gap-0 rounded-t-2xl"
            style={
              {
                bottom: keyboardInset,
                "--course-keyboard-inset": `${keyboardInset}px`,
              } as CSSProperties
            }
          >
            <SheetHeader className="relative pr-16">
              <SheetTitle>{t("learningDisplay.askTeacher")}</SheetTitle>
              <SheetClose
                render={
                  <button
                    type="button"
                    className="absolute top-1 right-3 flex size-11 items-center justify-center rounded-xl"
                    aria-label={t("common.close")}
                  />
                }
              >
                <X size={20} aria-hidden />
              </SheetClose>
            </SheetHeader>
            <SheetDescription className="course-conversation-ask-context">
              {heading ?? t("learningDisplay.lesson")}
            </SheetDescription>
            <div
              className="course-conversation-mobile-thread"
              ref={mobileThread}
            >
              {chat.messages.map((message, index) => (
                <div
                  key={`${index}-${message.role}`}
                  className="course-conversation-reply"
                  data-role={message.role}
                >
                  {message.quotedText ? (
                    <blockquote>{message.quotedText}</blockquote>
                  ) : null}
                  <MarkdownContent
                    content={message.content || t("learningDisplay.thinking")}
                  />
                </div>
              ))}
            </div>
            {renderComposer(true)}
          </SheetContent>
        </Sheet>
      ) : null}
    </section>
  );
}
