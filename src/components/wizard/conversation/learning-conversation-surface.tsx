"use client";

import { createContext, useContext, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@xue-learn/core/utils";
import { useT } from "@xue-learn/core/i18n";

type ConversationPersona = {
  name: string;
  avatarSrc?: string;
};

const ConversationPersonaContext = createContext<ConversationPersona>({
  name: "",
});

export function ConversationPersonaProvider({
  persona,
  children,
}: {
  persona: ConversationPersona;
  children: ReactNode;
}) {
  return (
    <ConversationPersonaContext.Provider value={persona}>
      {children}
    </ConversationPersonaContext.Provider>
  );
}

export function LearningConversationSurface({
  persona,
  children,
  footer,
  busy = false,
  className,
}: {
  persona: ConversationPersona;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  className?: string;
}) {
  const t = useT();

  return (
    <ConversationPersonaContext.Provider value={persona}>
      <section
        className={cn("mx-auto min-w-0 w-full max-w-[90rem] pb-8", className)}
        role="region"
        aria-busy={busy}
        aria-label={t("learningConversation.content")}
      >
        <div className="space-y-7">{children}</div>
        {footer ? (
          <div className="sticky bottom-0 z-20 mt-8 bg-linear-to-t from-background from-60% via-background/90 to-transparent px-0.5 pb-[calc(0.65rem+env(safe-area-inset-bottom,0px))] pt-6">
            {footer}
          </div>
        ) : null}
      </section>
    </ConversationPersonaContext.Provider>
  );
}

export function ConversationTurn({
  role,
  children,
  label,
  className,
}: {
  role: "assistant" | "learner" | "system";
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const t = useT();
  const persona = useContext(ConversationPersonaContext);

  if (role === "system") {
    return (
      <div
        className={cn(
          "mx-auto max-w-xl rounded-xl border border-[var(--course-content-border)] bg-[var(--course-content-surface-muted)] px-4 py-3 text-sm text-[var(--course-content-muted)]",
          className,
        )}
        role="status"
      >
        {children}
      </div>
    );
  }

  const assistant = role === "assistant";
  return (
    <article
      className={cn(
        "flex min-w-0 gap-3 md:gap-4",
        !assistant && "justify-end",
        className,
      )}
      aria-label={
        label ??
        (assistant ? persona.name : t("learningConversation.yourAnswer"))
      }
    >
      {assistant ? (
        persona.avatarSrc ? (
          <img
            src={persona.avatarSrc}
            alt=""
            className="size-11 shrink-0 rounded-full object-cover ring-1 ring-[var(--course-content-border)] md:size-[3.25rem]"
          />
        ) : (
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary md:size-[3.25rem]"
            aria-hidden
          >
            {persona.name.slice(0, 1)}
          </span>
        )
      ) : null}
      <div
        className={cn(
          "min-w-0",
          assistant
            ? "flex-1"
            : "max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-primary-foreground",
        )}
      >
        {assistant ? (
          <p className="mb-2 text-sm font-semibold text-[var(--course-content-muted)]">
            {persona.name}
          </p>
        ) : null}
        <div
          className={cn(
            "min-w-0 text-[1rem] leading-7",
            assistant &&
              "rounded-2xl rounded-tl-md bg-[var(--course-content-surface-muted)]/70 px-4 py-3.5 shadow-[0_8px_28px_rgba(15,23,42,0.06)] sm:px-5 sm:py-4",
          )}
        >
          {children}
        </div>
      </div>
    </article>
  );
}

export function ConversationActivity({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-2xl bg-[var(--course-content-surface-muted)]/55 p-4 sm:p-5",
        className,
      )}
      aria-label={label}
    >
      {children}
    </section>
  );
}

export function ConversationStatus({
  children,
  loading = false,
}: {
  children: ReactNode;
  loading?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-center gap-2 py-2 text-sm text-[var(--course-content-muted)]"
      role="status"
      aria-live="polite"
    >
      {loading ? (
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
      ) : null}
      {children}
    </div>
  );
}

export function ConversationTypingIndicator({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ConversationTurn role="assistant">
      <div
        className="inline-flex items-center gap-2 rounded-2xl bg-[var(--course-content-surface-muted)] px-3.5 py-2.5 text-sm text-[var(--course-content-muted)]"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="inline-flex gap-1" aria-hidden="true">
          <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-current" />
        </span>
        <span>{children}</span>
      </div>
    </ConversationTurn>
  );
}

export function ConversationDivider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1 text-xs font-semibold text-[var(--course-content-muted)]">
      <span className="h-px flex-1 bg-[var(--course-content-border)]" />
      <span>{children}</span>
      <span className="h-px flex-1 bg-[var(--course-content-border)]" />
    </div>
  );
}
