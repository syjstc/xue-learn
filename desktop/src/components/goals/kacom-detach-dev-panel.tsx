import { translateCurrent } from "@xue-learn/core/i18n";
import { Button } from "@xue-learn/core/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { DevTag } from "@/components/dev/dev-tag";
import { useDetachKacomForInternalTesting, useGoal } from "@/hooks/api";
import { useConfirm } from "@/hooks/use-confirm";
import { isDev } from "@xue-learn/core/dev";
import { FEATURE_KACOM_DETACH } from "@xue-learn/core/features";
import { useT } from "@xue-learn/core/i18n";

/** No learner-facing control: rendered only by the local dev build. */
export function KacomDetachDevPanel({ goalId }: { goalId: string }) {
  const t = useT();
  const { data: goal } = useGoal(goalId);
  const detachKacom = useDetachKacomForInternalTesting();
  const { alert, confirm } = useConfirm();

  if (
    !FEATURE_KACOM_DETACH ||
    !isDev() ||
    goal?.goalKind !== "full" ||
    goal.learningMode !== "mastery"
  ) {
    return null;
  }

  async function handleDetach() {
    const confirmed = await confirm({
      title: translateCurrent("desktop.copy.detachKacomDevelopmentOnly"),
      description: translateCurrent(
        "desktop.copy.thisSwitchesTheGoalToExplorationModeExistingKacomSnapshots",
      ),
      confirmLabel: translateCurrent(
        "desktop.ui.kacomDetachDevPanel.detachKacom",
      ),
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      await detachKacom.mutateAsync(goalId);
      await alert({
        title: translateCurrent("desktop.copy.kacomDetached"),
        description: translateCurrent(
          "desktop.copy.thisGoalNowUsesExplorationModeHistoricalKacomDataIs",
        ),
      });
    } catch (error) {
      await alert({
        title: translateCurrent("desktop.copy.couldNotDetach"),
        description:
          error instanceof Error
            ? error.message
            : translateCurrent("desktop.copy.tryAgainLater"),
      });
    }
  }

  return (
    <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
      <CardTitle className="flex items-center gap-2">
        {t("goalDetail.kacomDetachDev.title")} <DevTag />
      </CardTitle>
      <CardContent className="mt-2">
        <p className="text-sm text-[var(--text-500)]">
          {t("goalDetail.kacomDetachDev.description")}
        </p>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="mt-4"
          disabled={detachKacom.isPending}
          onClick={() => void handleDetach()}
        >
          {detachKacom.isPending
            ? t("desktop.ui.kacomDetachDevPanel.detaching")
            : t("desktop.ui.kacomDetachDevPanel.detachKacom")}
        </Button>
      </CardContent>
    </Card>
  );
}
