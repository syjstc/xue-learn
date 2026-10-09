import { Sparkles } from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { useEnableGoalMastery, useGoal } from "@/hooks/api";
import { useConfirm } from "@/hooks/use-confirm";
import { useT } from "@xue-learn/core/i18n";
import { supportsGoalMasteryTransition } from "@xue-learn/core/client-runtime";

/** User-facing opt-in for KACOM-backed mastery on a full exploration goal. */
export function EnableMasteryModePanel({ goalId }: { goalId: string }) {
  const t = useT();
  const { data: goal } = useGoal(goalId);
  const enableMastery = useEnableGoalMastery();
  const { alert, confirm } = useConfirm();

  if (!supportsGoalMasteryTransition()) {
    return null;
  }

  if (goal?.goalKind !== "full" || goal.learningMode !== "exploration") {
    return null;
  }

  const transition = goal.masteryTransition;
  const preparing =
    transition?.status === "queued" || transition?.status === "building";

  async function handleEnable() {
    const confirmed = await confirm({
      title: t("goalDetail.masteryMode.title"),
      description: t("goalDetail.masteryMode.enableConfirm"),
      confirmLabel: t("goalDetail.masteryMode.enable"),
    });
    if (!confirmed) return;

    try {
      await enableMastery.mutateAsync(goalId);
    } catch (error) {
      await alert({
        title: t("goalDetail.masteryMode.enableFailed"),
        description:
          error instanceof Error
            ? error.message
            : t("goalDetail.masteryMode.enableFailed"),
      });
    }
  }

  return (
    <Card>
      <CardTitle>{t("goalDetail.masteryMode.title")}</CardTitle>
      <CardContent className="mt-2">
        <p className="text-sm text-[var(--text-500)]">
          {preparing
            ? t("goalDetail.masteryMode.preparing")
            : t("goalDetail.masteryMode.description")}
        </p>
        {transition?.error ? (
          <p className="mt-2 text-sm text-destructive">{transition.error}</p>
        ) : null}
        <Button
          type="button"
          size="sm"
          className="mt-4"
          disabled={enableMastery.isPending}
          onClick={() => void handleEnable()}
        >
          <Sparkles className="size-4" aria-hidden />
          {preparing || transition?.retryable
            ? t("goalDetail.masteryMode.retry")
            : t("goalDetail.masteryMode.enable")}
        </Button>
      </CardContent>
    </Card>
  );
}
