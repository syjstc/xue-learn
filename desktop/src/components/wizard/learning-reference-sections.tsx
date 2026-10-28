"use client";

import { normalizeEscapedMarkdownNewlines } from "@xue-learn/core/common/normalize-html-line-breaks";
import type { ReactNode } from "react";
import {
  BookOpen,
  CircleHelp,
  Lightbulb,
  ListTree,
} from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import {
  LlmMarkdown,
  LlmMarkdownInline,
} from "@/components/markdown/llm-markdown";
import {
  learningTargetLabels,
  sqQuestionTexts,
} from "@/shared/domain/learning-targets";
import type { UnitLearningTarget } from "@/shared/domain/learning-targets";
import type { SqPreview } from "@xue-learn/core/schemas";
import { cn } from "@xue-learn/core/utils";
import { useT } from "@xue-learn/core/i18n";
import {
  ConversationTurn,
  ConversationTypingIndicator,
} from "./conversation/learning-conversation-surface.tsx";

export type CornellPreview = { notes: string; cues: string; summary: string };

const SQ_ITEM_BADGE = "bg-[var(--bg-300)] text-[var(--text-400)] font-medium";

const BLOCK_MARKDOWN_RE = /(^|\n)\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|\|)/;

function splitReadableSentences(content: string): string[] {
  const paragraphs = normalizeEscapedMarkdownNewlines(content)
    .split(/\n\s*\n|\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphs.length > 1) return paragraphs;

  return (
    paragraphs[0]
      ?.match(/[^。！？?!]+[。！？?!]?/g)
      ?.map((part) => part.trim())
      .filter(Boolean) ?? []
  );
}

function CornellSectionHeader({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-300)] text-[var(--course-content-link)]">
        {icon}
      </div>
      <div className="min-w-0">
        <h3
          className="font-semibold leading-tight text-[var(--course-content)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-[var(--course-content-muted)]">
          {description}
        </p>
      </div>
    </div>
  );
}

function MarkdownListItem({
  content,
  compact = false,
}: {
  content: string;
  compact?: boolean;
}) {
  return (
    <LlmMarkdownInline
      content={content}
      className={compact ? "text-sm" : undefined}
    />
  );
}

function SqSection({
  icon,
  label,
  description,
  chatLead,
  compact = false,
  conversationMode = false,
  children,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  chatLead?: string;
  compact?: boolean;
  conversationMode?: boolean;
  children: ReactNode;
}) {
  const sectionContent = (
    <>
      <div
        className={cn("flex items-start gap-2.5", compact ? "mb-2" : "mb-3")}
      >
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md bg-[var(--bg-300)] text-[var(--text-400)]",
            compact ? "h-6 w-6" : "h-8 w-8",
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "font-medium leading-snug text-[var(--text-800)]",
              compact ? "text-sm" : "text-base",
            )}
            style={{ fontFamily: "var(--font-display)" }}
          >
            {label}
          </h3>
          {description && !conversationMode ? (
            <p
              className={cn(
                "mt-0.5 text-[var(--text-400)]",
                compact ? "text-xs" : "text-sm",
              )}
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </>
  );

  if (conversationMode) {
    return (
      <div className="min-w-0 space-y-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:duration-500 sm:space-y-5">
        <ConversationTurn role="assistant">
          <p className="text-base leading-7 text-[var(--course-content)] sm:text-[1.05rem] sm:leading-8">
            {chatLead ?? description ?? label}
          </p>
        </ConversationTurn>
        <section
          className="min-w-0 rounded-2xl border border-[var(--course-content-border)] bg-[var(--course-content-surface-muted)] p-4 shadow-sm sm:ml-14 sm:p-5 md:ml-[4.25rem] md:p-6"
          aria-label={label}
        >
          {sectionContent}
        </section>
      </div>
    );
  }

  return (
    <section
      className={cn(
        "rounded-xl border border-[var(--border-200)] bg-[var(--bg-50)]",
        compact ? "p-3" : "p-4 md:p-5",
      )}
    >
      {sectionContent}
    </section>
  );
}

function SqOutlineList({
  items,
  compact = false,
  conversationMode = false,
}: {
  items: string[];
  compact?: boolean;
  conversationMode?: boolean;
}) {
  return (
    <ol className={cn("space-y-2", compact ? "space-y-1.5" : "space-y-2")}>
      {items.map((item, index) => (
        <li
          key={index}
          className={cn(
            "flex gap-3 rounded-lg border px-3 py-2.5",
            conversationMode
              ? "border-[var(--course-content-border)] bg-[var(--course-content-surface)]"
              : "border-[var(--border-200)] bg-[var(--bg-300)]/30",
            compact && "px-2.5 py-2",
          )}
        >
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-md tabular-nums",
              SQ_ITEM_BADGE,
              compact ? "h-5 min-w-5 text-[10px]" : "h-6 min-w-6 text-xs",
            )}
          >
            {index + 1}
          </span>
          <div
            className={cn(
              "min-w-0 flex-1 leading-relaxed text-[var(--text-800)]",
              compact ? "text-sm" : "text-base",
            )}
          >
            <MarkdownListItem content={item} compact={compact} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function SqKeyPointList({
  items,
  points,
  compact = false,
  conversationMode = false,
}: {
  items: string[];
  points?: UnitLearningTarget[];
  compact?: boolean;
  conversationMode?: boolean;
}) {
  const t = useT();
  return (
    <ul className={cn(compact ? "space-y-1.5" : "grid gap-2 sm:grid-cols-2")}>
      {items.map((item, index) => {
        const point = points?.[index];
        const importance = point?.importance
          ? ({ core: t("wizard.reference.importance.core"), supporting: t("wizard.reference.importance.supporting"), enrichment: t("wizard.reference.importance.enrichment") } as const)[
              point.importance
            ]
          : null;
        const difficulty = point?.difficulty
          ? ({ easy: t("wizard.reference.difficulty.easy"), medium: t("wizard.reference.difficulty.medium"), hard: t("wizard.reference.difficulty.hard") } as const)[
              point.difficulty
            ]
          : null;
        return (
          <li
            key={index}
            className={cn(
              "flex gap-2.5 rounded-lg border px-3 py-2.5",
              conversationMode
                ? "border-[var(--course-content-border)] bg-[var(--course-content-surface)]"
                : "border-[var(--border-200)] bg-[var(--bg-300)]/30",
              compact && "px-2.5 py-2",
            )}
          >
            <Lightbulb
              className={cn(
                "mt-0.5 shrink-0 text-[var(--text-400)]",
                compact ? "h-3.5 w-3.5" : "h-4 w-4",
              )}
              aria-hidden
            />
            <div
              className={cn(
                "min-w-0 flex-1 leading-relaxed text-[var(--text-800)]",
                compact ? "text-sm" : "text-sm md:text-base",
              )}
            >
              <MarkdownListItem content={item} compact={compact} />
              {point && (importance || difficulty) ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {importance ? (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        point.importance === "core"
                          ? "bg-[var(--brand-50)] text-[var(--brand-700)]"
                          : "bg-[var(--bg-200)] text-[var(--text-400)]",
                      )}
                    >
                      {importance}
                    </span>
                  ) : null}
                  {difficulty ? (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        point.difficulty === "hard"
                          ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                          : "bg-[var(--bg-200)] text-[var(--text-400)]",
                      )}
                    >
                      {difficulty}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SqQuestionList({
  items,
  compact = false,
  conversationMode = false,
}: {
  items: string[];
  compact?: boolean;
  conversationMode?: boolean;
}) {
  return (
    <ol className={cn("space-y-2", compact ? "space-y-1.5" : "space-y-2.5")}>
      {items.map((item, index) => (
        <li
          key={index}
          className={cn(
            "rounded-lg border px-3 py-3",
            conversationMode
              ? "border-[var(--course-content-border)] bg-[var(--course-content-surface)]"
              : "border-[var(--border-200)] bg-[var(--bg-300)]/30",
            compact && "px-2.5 py-2",
          )}
        >
          <div
            className={cn(
              "min-w-0 leading-relaxed text-[var(--text-800)]",
              compact ? "text-sm" : "text-base",
            )}
          >
            <MarkdownListItem content={item} compact={compact} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function SqReferenceSlots({
  sq,
  compact = false,
  isMicro = false,
  conversationMode = false,
  loading = false,
  status,
}: {
  sq?: SqPreview;
  compact?: boolean;
  isMicro?: boolean;
  conversationMode?: boolean;
  loading?: boolean;
  status?: string;
}) {
  const t = useT();
  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const outline = sq?.survey?.outline ?? [];
  const targetLabels = learningTargetLabels(sq?.learningTargets);
  const microPreviewPoints = [...targetLabels, ...outline];
  const questions = sqQuestionTexts(sq?.questions ?? []);

  return (
    <div
      className={cn(
        compact ? "space-y-3" : conversationMode ? "space-y-8" : "space-y-5",
      )}
    >
      {isMicro && microPreviewPoints.length > 0 ? (
        <SqSection
          icon={<ListTree className={iconSize} />}
          label={t("wizard.reference.previewPoints")}
          description={
            compact ? undefined : t("wizard.reference.previewPointsDescription")
          }
          chatLead={t("wizard.reference.previewPointsLead")}
          compact={compact}
          conversationMode={conversationMode}
        >
          <SqOutlineList
            items={microPreviewPoints}
            compact={compact}
            conversationMode={conversationMode}
          />
        </SqSection>
      ) : null}

      {!isMicro && targetLabels.length > 0 ? (
        <SqSection
          icon={<BookOpen className={iconSize} />}
          label={t("wizard.reference.learningTargets")}
          description={
            compact ? undefined : t("wizard.reference.learningTargetsDescription")
          }
          chatLead={t("wizard.reference.learningTargetsLead")}
          compact={compact}
          conversationMode={conversationMode}
        >
          <SqKeyPointList
            items={targetLabels}
            points={sq?.learningTargets as UnitLearningTarget[] | undefined}
            compact={compact}
            conversationMode={conversationMode}
          />
        </SqSection>
      ) : null}

      {!isMicro && outline.length > 0 ? (
        <SqSection
          icon={<ListTree className={iconSize} />}
          label={t("wizard.reference.outline")}
          description={compact ? undefined : t("wizard.reference.outlineDescription")}
          chatLead={t("wizard.reference.outlineLead")}
          compact={compact}
          conversationMode={conversationMode}
        >
          <SqOutlineList
            items={outline}
            compact={compact}
            conversationMode={conversationMode}
          />
        </SqSection>
      ) : null}

      {questions.length > 0 ? (
        <SqSection
          icon={<CircleHelp className={iconSize} />}
          label={t("wizard.reference.guidingQuestions")}
          description={
            compact ? undefined : t("wizard.reference.guidingQuestionsDescription")
          }
          chatLead={t("wizard.reference.guidingQuestionsLead")}
          compact={compact}
          conversationMode={conversationMode}
        >
          <SqQuestionList
            items={questions}
            compact={compact}
            conversationMode={conversationMode}
          />
        </SqSection>
      ) : null}

      {loading && conversationMode ? (
        <ConversationTypingIndicator>
          {status?.trim()
            ? status
            : `${t("wizard.reference.preparing")}${
                isMicro
                  ? t("wizard.reference.previewPoints")
                  : targetLabels.length === 0
                    ? t("wizard.reference.learningTargets")
                    : outline.length === 0
                      ? t("wizard.reference.outline")
                      : questions.length === 0
                        ? t("wizard.reference.guidingQuestions")
                        : t("wizard.reference.previewContent")
              }…`}
        </ConversationTypingIndicator>
      ) : null}
    </div>
  );
}

export function SqReferenceContent({
  sq,
  compact = false,
  isMicro = false,
  conversationMode = false,
  loading = false,
  status,
}: {
  sq: SqPreview;
  compact?: boolean;
  isMicro?: boolean;
  conversationMode?: boolean;
  loading?: boolean;
  status?: string;
}) {
  return (
    <SqReferenceSlots
      sq={sq}
      compact={compact}
      isMicro={isMicro}
      conversationMode={conversationMode}
      loading={loading}
      status={status}
    />
  );
}

export function SqReferenceLoading({
  isMicro = false,
  status,
}: {
  isMicro?: boolean;
  status?: string;
}) {
  return (
    <SqReferenceSlots isMicro={isMicro} conversationMode loading status={status} />
  );
}

export function GuidingQuestionsRecapContent({
  questions,
  answers,
  compact = false,
  showHeading = true,
  onGenerateAnswers,
  generatingAnswers,
}: {
  questions: Array<string | { text: string; learningTargetIds?: string[] }>;
  answers?: string[] | null;
  compact?: boolean;
  showHeading?: boolean;
  onGenerateAnswers?: () => void;
  generatingAnswers?: boolean;
}) {
  const textClass = compact ? "text-sm" : "text-base";
  const t = useT();
  const questionTexts = sqQuestionTexts(
    questions.map((question) =>
      typeof question === "string" ? { text: question } : question,
    ),
  );
  const hasAnswers = Boolean(answers?.some((answer) => answer.trim()));

  return (
    <div className={`space-y-3 text-[var(--course-content)] ${textClass}`}>
      <div>
        {showHeading ? (
          <>
            <p
              className="font-medium text-[var(--course-content)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {t("wizard.reference.guidingQuestions")}
            </p>
            {!compact ? (
              <p
                className="mt-0.5 text-[var(--course-content-muted)]"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {t("wizard.reference.recapDescription")}
              </p>
            ) : null}
          </>
        ) : (
          <p
            className="text-[var(--course-content-muted)]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {t("wizard.reference.recapDescription")}
          </p>
        )}
        <ol className="mt-2 list-decimal space-y-3 pl-4">
          {questionTexts.map((question, index) => (
            <li key={index}>
              <MarkdownListItem content={question} compact={compact} />
              {answers?.[index]?.trim() ? (
                <div className="mt-1.5 rounded-md border border-[var(--course-content-border-accent)] bg-[var(--course-content-surface-accent)] px-3 py-2 text-[var(--course-content)]">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--course-content-link)]">
                    {t("wizard.reference.sampleAnswer")}
                  </p>
                  <LlmMarkdown
                    content={answers[index]}
                    variant={compact ? "compact" : "default"}
                    className="mt-0.5"
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
      {onGenerateAnswers ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onGenerateAnswers}
          disabled={generatingAnswers}
        >
          {generatingAnswers
            ? t("wizard.reference.generatingAnswers")
            : hasAnswers
              ? t("wizard.reference.regenerateAnswers")
              : t("wizard.reference.generateAnswers")}
        </Button>
      ) : null}
    </div>
  );
}

export function CornellReferenceContent({
  cornell,
  compact = false,
}: {
  cornell: CornellPreview;
  compact?: boolean;
}) {
  const t = useT();
  if (compact) {
    return (
      <div className="space-y-3 text-sm text-[var(--course-content)]">
        {[
          {
            title: t("wizard.reference.notes"),
            content: cornell.notes,
            className: "bg-transparent",
          },
          {
            title: t("wizard.reference.recallCues"),
            content: cornell.cues,
            className: "bg-[var(--course-content-attention-bg)]",
          },
          {
            title: t("wizard.reference.summary"),
            content: cornell.summary,
            className: "bg-[var(--course-content-surface-accent)]",
          },
        ].map(({ title, content, className }) => (
          <section key={title} className={cn("rounded-lg p-3", className)}>
            <p
              className="font-semibold text-[var(--course-content)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {title}
            </p>
            <LlmMarkdown content={content} variant="compact" className="mt-1" />
          </section>
        ))}
      </div>
    );
  }

  const noteChunks = splitReadableSentences(cornell.notes);
  const cueChunks = splitReadableSentences(cornell.cues);
  const summaryChunks = splitReadableSentences(cornell.summary);
  const notesAreStructured = BLOCK_MARKDOWN_RE.test(cornell.notes);
  const cuesAreStructured = BLOCK_MARKDOWN_RE.test(cornell.cues);
  const summaryIsStructured = BLOCK_MARKDOWN_RE.test(cornell.summary);

  return (
    <div className="space-y-5 text-[var(--course-content)]">
      <section className="rounded-2xl border border-[var(--course-content-border)] bg-[var(--course-content-surface)] p-4 md:p-6">
        <CornellSectionHeader
          icon={<BookOpen className="h-4.5 w-4.5" aria-hidden />}
          title={t("wizard.reference.coreNotes")}
          description={t("wizard.reference.coreNotesDescription")}
        />
        {notesAreStructured ? (
          <LlmMarkdown
            content={cornell.notes}
            variant="default"
            className="mt-5 max-w-4xl"
          />
        ) : (
          <ol className="mt-5 grid gap-x-8 gap-y-0 xl:grid-cols-2">
            {noteChunks.map((chunk, index) => (
              <li
                key={`${index}-${chunk.slice(0, 24)}`}
                className="flex gap-3 border-t border-[var(--course-content-border)] py-4 first:border-t-0 first:pt-0 xl:[&:nth-child(2)]:border-t-0 xl:[&:nth-child(2)]:pt-0"
              >
                <span className="mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-300)] text-xs font-semibold tabular-nums text-[var(--course-content-muted)]">
                  {index + 1}
                </span>
                <div className="min-w-0 text-base leading-8">
                  <LlmMarkdownInline content={chunk} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--course-content-attention-border)] bg-[var(--course-content-attention-bg)] p-4 md:p-6">
        <CornellSectionHeader
          icon={<CircleHelp className="h-4.5 w-4.5" aria-hidden />}
          title={t("wizard.reference.reviewCues")}
          description={t("wizard.reference.reviewCuesDescription")}
        />
        {cuesAreStructured ? (
          <LlmMarkdown
            content={cornell.cues}
            variant="default"
            className="mt-5"
          />
        ) : (
          <ol className="mt-5 grid gap-3 md:grid-cols-2">
            {cueChunks.map((cue, index) => (
              <li
                key={`${index}-${cue.slice(0, 24)}`}
                className="flex gap-3 rounded-xl border border-[var(--course-content-attention-border)] bg-[var(--course-content-surface)]/70 px-4 py-3.5"
              >
                <span className="mt-0.5 text-xs font-semibold tabular-nums text-[var(--course-content-link)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 text-[15px] leading-7">
                  <LlmMarkdownInline content={cue} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--course-content-border-accent)] bg-[var(--course-content-surface-accent)] p-4 md:p-6">
        <CornellSectionHeader
          icon={<Lightbulb className="h-4.5 w-4.5" aria-hidden />}
          title={t("wizard.reference.oneMinuteReview")}
          description={t("wizard.reference.oneMinuteReviewDescription")}
        />
        {summaryIsStructured ? (
          <LlmMarkdown
            content={cornell.summary}
            variant="default"
            className="mt-5 max-w-4xl"
          />
        ) : (
          <ul className="mt-5 grid gap-3 md:grid-cols-2">
            {summaryChunks.map((item, index) => (
              <li
                key={`${index}-${item.slice(0, 24)}`}
                className="flex gap-3 rounded-xl bg-[var(--course-content-surface)]/60 px-4 py-3.5"
              >
                <Lightbulb
                  className="mt-1 h-4 w-4 shrink-0 text-[var(--course-content-link)]"
                  aria-hidden
                />
                <div className="min-w-0 text-[15px] leading-7">
                  <LlmMarkdownInline content={item} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function ReferenceSection({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <details
      className="group rounded-lg border border-transparent open:border-border/60 open:bg-muted/40"
      open={defaultOpen}
    >
      <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-[var(--text-800)] marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-2">
          {title}
          <span className="text-xs font-normal text-[var(--text-400)] group-open:hidden">
            {t("wizard.reference.expand")}
          </span>
          <span className="hidden text-xs font-normal text-[var(--text-400)] group-open:inline">
            {t("wizard.reference.collapse")}
          </span>
        </span>
      </summary>
      <div className="border-t border-border/40 px-3 pb-3 pt-2">{children}</div>
    </details>
  );
}
