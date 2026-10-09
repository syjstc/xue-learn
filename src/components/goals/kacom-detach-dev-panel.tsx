import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { DevTag } from "@/components/dev/dev-tag";
import { useDetachKacomForInternalTesting, useGoal } from "@/hooks/api";
import { useConfirm } from "@/hooks/use-confirm";
import { isDev } from "@xue-learn/core/source/src/shared/dev.ts";
import { FEATURE_KACOM_DETACH } from "@xue-learn/core/source/src/shared/features.ts";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

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
      title: "解除 KACOM（仅开发环境）",
      description:
        "这会把目标切换为探索模式。已有 KACOM 快照、目标和证据会保留，但不再参与当前学习、议程或全局学习状态。",
      confirmLabel: "解除 KACOM",
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      await detachKacom.mutateAsync(goalId);
      await alert({
        title: "已解除 KACOM",
        description: "该目标现在按探索模式运行；历史 KACOM 数据仍被保留。",
      });
    } catch (error) {
      await alert({
        title: "解除失败",
        description: error instanceof Error ? error.message : "请稍后重试。",
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
          {detachKacom.isPending ? "解除中…" : "解除 KACOM"}
        </Button>
      </CardContent>
    </Card>
  );
}
