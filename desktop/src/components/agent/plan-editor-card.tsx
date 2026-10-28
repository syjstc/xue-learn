"use client";

import { useState } from "react";
import { XCircle } from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { GoalMapPlan } from "@/shared/api";
import { useT } from "@xue-learn/core/i18n";
import { GoalPlanStreamCard } from "./goal-plan-stream-card.tsx";

export function PlanEditorCard({
  plan,
  disabled,
  onSubmit,
  onCancel,
}: {
  plan: GoalMapPlan | null;
  isMicroCourse?: boolean;
  disabled?: boolean;
  onSubmit: (result: { approved: boolean; feedback?: string }) => void;
  onCancel?: () => void;
}) {
  const t = useT();
  const [aiInstruction, setAiInstruction] = useState("");
  const isSequentialPlan =
    plan?.schemaVersion === 2 && Boolean(plan.modules?.length);

  if (!plan) {
    return (
      <Card className="border-border bg-card/80">
        <CardContent className="text-sm text-muted-foreground">
          {t("planEditor.unavailable")}
        </CardContent>
      </Card>
    );
  }
  return (
    <GoalPlanStreamCard plan={plan} ready>
      <div className="space-y-3">
        <Card className="border-[var(--border-200)] bg-[var(--bg-50)]/70 py-0">
          <CardContent className="space-y-1.5 py-3">
            <Label htmlFor="contract-ai-instruction">
              {t("planEditor.askAi")}
            </Label>
            <Textarea
              id="contract-ai-instruction"
              className="min-h-[72px] resize-y"
              placeholder={t("planEditor.placeholder")}
              value={aiInstruction}
              disabled={disabled}
              onChange={(event) => setAiInstruction(event.target.value)}
            />
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          {onCancel ? (
            <Button
              type="button"
              size="sm"
              disabled={disabled}
              variant="outline"
              onClick={onCancel}
            >
              <XCircle className="size-4" />
              {t("planEditor.cancelExit")}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={disabled || !aiInstruction.trim()}
            variant="outline"
            onClick={() =>
              onSubmit({
                approved: false,
                feedback: aiInstruction.trim(),
              })
            }
          >
            {t("planEditor.sendAdjustment")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => onSubmit({ approved: true })}
          >
            {isSequentialPlan
              ? t("planEditor.confirmJourney")
              : t("planEditor.confirmMap")}
          </Button>
        </div>
      </div>
    </GoalPlanStreamCard>
  );
}
