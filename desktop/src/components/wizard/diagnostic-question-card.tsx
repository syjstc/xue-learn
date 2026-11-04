"use client";

import { useT } from "@xue-learn/core/i18n";
import { LlmMarkdownInline } from "@/components/markdown/llm-markdown";
import { Card } from "@/components/ui/card";

export type DiagnosticChoiceQuestion = {
  type: "mcq" | "mcq_multi";
  question: string;
  options: string[];
};

export function DiagnosticQuestionCard({
  question,
  index,
  value,
  disabled = false,
  onChoose,
}: {
  question: DiagnosticChoiceQuestion;
  index: number;
  value?: number | number[];
  disabled?: boolean;
  onChoose: (optionIndex: number) => void;
}) {
  const t = useT();
  return (
    <Card>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-medium">
        <span className="shrink-0 tabular-nums">{index + 1}.</span>
        <div className="min-w-0 flex-1">
          <LlmMarkdownInline content={question.question} />
        </div>
      </div>
      {question.type === "mcq_multi" && (
        <p className="mt-1 text-xs text-muted-foreground">{t("diagnostic.multi")}</p>
      )}
      <div className="mt-3 space-y-2">
        {question.options.map((option, optionIndex) => {
          const checked = Array.isArray(value) ? value.includes(optionIndex) : value === optionIndex;
          return (
            <label key={optionIndex} className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/50">
              <input type={question.type === "mcq_multi" ? "checkbox" : "radio"}
                name={`question-${index}`} checked={checked} disabled={disabled}
                onChange={() => onChoose(optionIndex)} className="mt-1" />
              <span className="text-sm"><LlmMarkdownInline content={option} /></span>
            </label>
          );
        })}
      </div>
    </Card>
  );
}
