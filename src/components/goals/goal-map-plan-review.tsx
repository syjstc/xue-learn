"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { Card, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InlineGenStream } from "@/components/ai/inline-gen-stream";
import { GoalMapPlanDisplay } from "@/components/goals/goal-map-plan-display";
import { useAiGeneration } from "@/hooks/use-ai-generation";
import { useConfirmGoalPlan } from "@/hooks/api";
import {
  apiGet,
  queryKeys,
  type GoalMapPlan,
  type GoalPlanResponse,
} from "@/shared/api";
import { useQueryClient } from "@tanstack/react-query";
import type { SseEvent } from "@/shared/llm/sse";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

export function GoalMapPlanReview({
  goalId,
  goalTitle,
  onApproved,
  onTitleRefined,
  generationEnabled = true,
}: {
  goalId: string;
  goalTitle: string;
  isMicroCourse?: boolean;
  onApproved: () => void;
  onTitleRefined?: (title: string) => void;
  generationEnabled?: boolean;
}) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [displayTitle, setDisplayTitle] = useState(goalTitle);
  const [aiInstruction, setAiInstruction] = useState("");
  const [plan, setPlan] = useState<GoalMapPlan | null>(null);
  const isSequentialPlan =
    plan?.schemaVersion === 2 && Boolean(plan.modules?.length);
  const startedRef = useRef(false);
  const queryClient = useQueryClient();
  const confirmPlan = useConfirmGoalPlan();
  const aiGen = useAiGeneration({
    scope: "goal",
    scopeId: goalId,
    onRestore: (run) => {
      if (run.statusMessage) setStatus(run.statusMessage);
    },
  });
  const busy = aiGen.loading || confirmPlan.isPending;

  const handleStreamEvent = useCallback(
    (event: SseEvent) => {
      if (event.type === "status") setStatus(event.message);
      if (
        event.type === "done" &&
        event.plan &&
        typeof event.plan === "object"
      ) {
        setPlan(event.plan as GoalMapPlan);
        if (typeof event.title === "string") {
          setDisplayTitle(event.title);
          onTitleRefined?.(event.title);
        }
        void queryClient.invalidateQueries({
          queryKey: queryKeys.goals.plan(goalId),
        });
      }
    },
    [goalId, onTitleRefined, queryClient],
  );

  const runContractStream = useCallback(
    async (regenerate = false) => {
      setError("");
      if (regenerate) setPlan(null);
      setStatus(
        regenerate
          ? t("goalDetail.planReview.adjusting")
          : t("goalDetail.planReview.organizing"),
      );
      try {
        await aiGen.startPost(
          `/api/goals/${goalId}/plan/stream`,
          { regenerate, adjustment: aiInstruction.trim() },
          handleStreamEvent,
          "goal.plan.contract",
        );
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : t("goalDetail.planReview.organizeError"),
        );
      } finally {
        setLoading(false);
      }
    },
    [aiGen, aiInstruction, goalId, handleStreamEvent, t],
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    async function init() {
      try {
        const data = await queryClient.fetchQuery({
          queryKey: queryKeys.goals.plan(goalId),
          queryFn: () => apiGet<GoalPlanResponse>(`/api/goals/${goalId}/plan`),
        });
        if (data.hasMap) {
          setLoading(false);
          return;
        }
        if (data.plan) {
          setPlan(data.plan);
          setLoading(false);
          return;
        }
        if (!generationEnabled) {
          setError(t("goalDetail.planReview.organizeError"));
          setLoading(false);
          return;
        }
        const reconnected = await aiGen.reconnectActive(
          handleStreamEvent,
          (operation) => operation === "goal.plan.contract",
        );
        if (reconnected.length === 0) await runContractStream(false);
        else setLoading(false);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : t("goalDetail.planReview.loadError"),
        );
        setLoading(false);
      }
    }
    void init();
  }, [
    aiGen,
    generationEnabled,
    goalId,
    handleStreamEvent,
    queryClient,
    runContractStream,
    t,
  ]);

  async function confirm() {
    setError("");
    try {
      await confirmPlan.mutateAsync(goalId);
      onApproved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("goalDetail.planReview.confirmError"),
      );
    }
  }

  if ((loading || aiGen.loading) && !plan) {
    return (
      <Card>
        <CardTitle style={{ fontFamily: "var(--font-display)" }}>
          {t("goalDetail.planReview.organizingTitle")}
        </CardTitle>
        <p className="mt-2 text-sm text-[var(--text-400)]">
          {t("goalDetail.planReview.organizingDescription")}
        </p>
        <InlineGenStream
          status={status}
          canStop={aiGen.canStop()}
          onStop={() => void aiGen.stop()}
          className="mt-4"
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle style={{ fontFamily: "var(--font-display)" }}>
          {t("goalDetail.planReview.title")}
        </CardTitle>
        <p className="mt-1 text-sm text-[var(--text-400)]">
          {isSequentialPlan
            ? t("goalDetail.planReview.sequentialDescription")
            : t("goalDetail.planReview.mapDescription")}
        </p>
        <p className="mt-3 rounded-lg bg-[var(--bg-200)] px-3 py-2 text-sm font-medium text-[var(--text-800)]">
          {displayTitle}
        </p>
      </Card>

      {plan ? (
        <GoalMapPlanDisplay topicOverview={plan.topicOverview} plan={plan} />
      ) : null}

      <Card>
        {generationEnabled ? (
          <>
            <Label htmlFor="contract-ai-instruction">
              {t("goalDetail.planReview.revisionLabel")}
            </Label>
            <Textarea
              id="contract-ai-instruction"
              className="mt-2 min-h-[72px] resize-y"
              placeholder={t("goalDetail.planReview.revisionPlaceholder")}
              value={aiInstruction}
              disabled={busy}
              onChange={(event) => setAiInstruction(event.target.value)}
            />
          </>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-lg bg-[var(--error-50)] p-2 text-sm text-[var(--error-500)]">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {generationEnabled ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !aiInstruction.trim()}
                onClick={() => void runContractStream(true)}
              >
                {t("goalDetail.planReview.sendRevision")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void runContractStream(true)}
              >
                {t("goalDetail.planReview.regenerate")}
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={busy || !plan}
            onClick={() => void confirm()}
          >
            {isSequentialPlan
              ? t("goalDetail.planReview.confirmJourney")
              : t("goalDetail.planReview.confirmMap")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
