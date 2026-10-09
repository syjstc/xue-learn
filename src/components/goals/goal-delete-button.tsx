import { Trash2 } from "lucide-react";
import { useDeleteGoal } from "@/hooks/api";
import { useConfirm } from "@/hooks/use-confirm";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { apiGet, type FoundationGoalsResponse } from "@/shared/api";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

function deleteGoalWarning(
  goalTitle: string,
  foundationGoalCount: number,
  t: ReturnType<typeof useT>,
) {
  if (foundationGoalCount > 0) {
    return t("goalDelete.description.withFoundations", {
      title: goalTitle,
      count: foundationGoalCount,
    });
  }
  return t("goalDelete.description", { title: goalTitle });
}

export function GoalDeleteButton({
  goalId,
  goalTitle,
  onDeleted,
  display = "button",
  /** When known (e.g. from goal detail), skips the foundations fetch. */
  foundationGoalCount,
}: {
  goalId: string;
  goalTitle: string;
  onDeleted?: () => void;
  display?: "button" | "menu-item";
  foundationGoalCount?: number;
}) {
  const t = useT();
  const deleteGoal = useDeleteGoal();
  const { confirm, alert } = useConfirm();

  async function handleDelete() {
    let subGoalCount = foundationGoalCount ?? 0;
    if (foundationGoalCount === undefined) {
      try {
        const data = await apiGet<FoundationGoalsResponse>(
          `/api/goals/${encodeURIComponent(goalId)}/foundation-goals`,
        );
        subGoalCount = data.foundationGoals.length;
      } catch {
        subGoalCount = 0;
      }
    }

    const ok = await confirm({
      title: t("goalDelete.title"),
      description: deleteGoalWarning(goalTitle, subGoalCount, t),
      variant: "destructive",
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;

    deleteGoal.mutate(goalId, {
      onSuccess: () => onDeleted?.(),
      onError: (err) => {
        void alert({
          title: t("goalDelete.failed"),
          description: err.message || t("goalDelete.failed"),
        });
      },
    });
  }

  const label = deleteGoal.isPending
    ? t("goalDelete.pending")
    : t("common.delete");

  if (display === "menu-item") {
    return (
      <DropdownMenuItem
        variant="destructive"
        disabled={deleteGoal.isPending}
        onClick={() => void handleDelete()}
      >
        <Trash2 className="size-4" />
        {label}
      </DropdownMenuItem>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={deleteGoal.isPending}
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      onClick={handleDelete}
    >
      {label}
    </Button>
  );
}
