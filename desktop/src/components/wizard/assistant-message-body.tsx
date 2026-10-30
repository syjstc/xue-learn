"use client";

import { CitationMarkdownContent } from "@/components/citations/citation-markdown-content";
import type { ProseMarkdownVariant } from "@xue-learn/core/components/markdown/prose-markdown";
import { typingCaretHostClassName } from "@/components/ui/typing-caret";
import { useLearnerDisplayName } from "@/hooks/api/use-learner-profile";
import type { ContentSource } from "@xue-learn/core/shared/types/content-sources";
import { personalizeLearnerText } from "@/shared/domain/learner-text";
import { parseAssistantMessageContent } from "@/shared/llm/parse-assistant-content";
import { useT } from "@xue-learn/core/i18n";
import { ThinkingBlock } from "./thinking-block.tsx";

function AssistantMarkdown({
  content,
  sources,
  showCursor,
  onNavigate,
  variant,
}: {
  content: string;
  sources?: ContentSource[];
  showCursor?: boolean;
  onNavigate?: () => void;
  variant?: ProseMarkdownVariant;
}) {
  if (!content) return null;

  return (
    <div className="mt-0.5 leading-relaxed">
      <CitationMarkdownContent
        content={content}
        sources={sources}
        variant={variant}
        className={showCursor ? typingCaretHostClassName : undefined}
        onInternalLinkClick={onNavigate}
      />
    </div>
  );
}

export function AssistantMessageBody({
  content,
  sources,
  showCursor,
  thinking: isThinking,
  thinkingContent,
  onNavigate,
  variant,
}: {
  content: string;
  sources?: ContentSource[];
  showCursor?: boolean;
  thinking?: boolean;
  thinkingContent?: string;
  onNavigate?: () => void;
  variant?: ProseMarkdownVariant;
}) {
  const t = useT();
  const learnerName = useLearnerDisplayName();
  const personalizedContent = personalizeLearnerText(content, learnerName);
  const parsed = parseAssistantMessageContent(personalizedContent);
  const {
    thinking: parsedThinking,
    thinkingComplete,
    main,
    hadThinkingTag,
  } = parsed;

  const thinkingText = thinkingContent?.trim() || parsedThinking?.trim() || "";
  const showThinkingBlock =
    isThinking || thinkingText.length > 0 ||
    (hadThinkingTag && (thinkingText.length > 0 || !thinkingComplete));
  const showMain = main.length > 0;
  const thinkingLoading = Boolean(isThinking) || (Boolean(showCursor) && !thinkingComplete);
  const collapseThinking = Boolean(showThinkingBlock && !thinkingLoading);

  return (
    <div className="mt-0.5">
      {showThinkingBlock && (
        <ThinkingBlock
          content={thinkingText}
          collapsed={collapseThinking}
          loading={thinkingLoading}
        />
      )}
      {showMain ? (
        <AssistantMarkdown
          content={main}
          sources={sources}
          showCursor={showCursor}
          onNavigate={onNavigate}
          variant={variant}
        />
      ) : null}
      {!showThinkingBlock && !showMain && showCursor && (
        <p className="mt-1 text-muted-foreground animate-pulse">
          {t("wizard.assistant.typing")}
        </p>
      )}
    </div>
  );
}
