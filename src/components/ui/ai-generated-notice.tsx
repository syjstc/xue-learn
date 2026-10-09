import { Sparkles } from "lucide-react";
import { useT } from "@xue-learn/core/i18n";
import { cn } from "@xue-learn/core/utils";

export type AiGeneratedNoticeKind = "content" | "assistant" | "partial";

export function AiGeneratedNotice({
  kind = "content",
  className,
}: {
  kind?: AiGeneratedNoticeKind;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border border-blue-300/80 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-900 dark:border-blue-500/60 dark:bg-blue-950/80 dark:text-blue-100",
        className,
      )}
      role="note"
      data-aigc-notice={kind}
    >
      <Sparkles className="size-3.5 shrink-0" aria-hidden />
      <span>{t(`aigc.notice.${kind}`)}</span>
    </div>
  );
}
