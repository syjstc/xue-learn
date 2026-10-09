"use client";

import { CitationMarkdownContent } from "@/components/citations/citation-markdown-content";
import type { ProseMarkdownVariant } from "@xue-learn/core/source/src/components/markdown/prose-markdown.tsx";
import {
  TypingCaret,
  typingCaretHostClassName,
} from "@/components/ui/typing-caret";
import { useLearnerDisplayName } from "@/hooks/api/use-learner-profile";
import type { ContentSource } from "@xue-learn/core/source/src/shared/types/content-sources.ts";
import { personalizeLearnerText } from "@/shared/domain/learner-text";
import { parseAssistantMessageContent } from "@/shared/llm/parse-assistant-content";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
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
  onNavigate,
  variant,
}: {
  content: string;
  sources?: ContentSource[];
  showCursor?: boolean;
  thinking?: boolean;
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

  const thinkingText = parsedThinking?.trim() ?? "";
  const showThinkingBlock =
    isThinking ||
    (hadThinkingTag && (thinkingText.length > 0 || !thinkingComplete));
  const showMain = main.length > 0;
  const collapseThinking =
    showThinkingBlock &&
    thinkingComplete &&
    (showMain || thinkingText.length > 0);

  if (!hadThinkingTag) {
    if (isThinking && !personalizedContent) {
      return <ThinkingBlock content="thinking" collapsed={false} loading />;
    }
    if (!personalizedContent && showCursor) {
      return (
        <p className="mt-1 text-muted-foreground animate-pulse">
          {t("wizard.assistant.typing")}
        </p>
      );
    }
    return (
      <AssistantMarkdown
        content={personalizedContent}
        sources={sources}
        showCursor={showCursor}
        onNavigate={onNavigate}
        variant={variant}
      />
    );
  }

  return (
    <div className="mt-0.5">
      {showThinkingBlock && (
        <ThinkingBlock
          content="thinking"
          collapsed={collapseThinking}
          loading={Boolean(isThinking) || !thinkingComplete}
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
      ) : (
        !thinkingComplete && showCursor && <TypingCaret />
      )}
      {thinkingComplete && !showMain && showCursor && (
        <p className="mt-1 text-muted-foreground animate-pulse">
          {t("wizard.assistant.typing")}
        </p>
      )}
    </div>
  );
}
