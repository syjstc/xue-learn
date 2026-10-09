import { RotateCcw } from "lucide-react";
import { useIsMutating } from "@tanstack/react-query";
import { Button } from "@xue-learn/core/ui/button";
import { useConfirm } from "@/hooks/use-confirm";
import { useGoalCreationSessionActions } from "@/hooks/use-goal-creation-session";
import { useT } from "@xue-learn/core/i18n";
import { cn } from "@xue-learn/core/utils";

export function GoalCreationRetryButton({
  sessionId,
  prominent = false,
  disabled = false,
  className,
}: {
  sessionId: string;
  prominent?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const t = useT();
  const { alert } = useConfirm();
  const actions = useGoalCreationSessionActions();
  const mutating =
    useIsMutating({ mutationKey: ["goal-creation-session", "retry"] }) > 0;
  const pending = actions.retry.isPending || mutating;

  return (
    <Button
      type="button"
      variant="default"
      size={prominent ? "lg" : "sm"}
      disabled={disabled || pending}
      className={cn(
        "shrink-0",
        prominent && "h-11 min-w-48 gap-2 px-5 text-base",
        className,
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        actions.retry.mutate(sessionId, {
          onError: (error) =>
            void alert({
              title: t("goalCreation.retry"),
              description:
                error instanceof Error
                  ? error.message
                  : t("goalCreation.tryAgainLater"),
            }),
        });
      }}
    >
      <RotateCcw className={cn("size-3.5", prominent && "size-4", pending && "animate-spin")} />
      {prominent ? t("goalCreation.retryCreation") : t("goalCreation.retry")}
    </Button>
  );
}
