import { useT } from "@xue-learn/core/i18n";
import { isDesktopLocalRuntime } from "@xue-learn/core/client-runtime";
import { Button } from "@xue-learn/core/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useLearningTrajectory } from "./use-learning-trajectory.ts";
import { LearningBranchCard } from "./branch-card.tsx";
/** The fixed-height slot prevents incoming supplements from moving the reading surface. */
export function SectionSupplements({
  unitId,
  sectionId,
}: {
  unitId: string;
  sectionId: string;
}) {
  const t = useT(),
    query = useLearningTrajectory(unitId);
  if (!isDesktopLocalRuntime()) return null;
  const branches =
    query.data?.branches.filter(
      (b) => b.origin.sectionId === sectionId && b.status !== "dismissed",
    ) ?? [];
  return (
    <div className="flex h-8 shrink-0 justify-end">
      {branches.length > 0 && (
        <Popover>
          <PopoverTrigger render={<Button variant="ghost" size="sm" />}>
            {t("trajectory.nearby")} · {branches.length}
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="max-h-[65vh] w-80 max-w-[90vw] space-y-3 overflow-auto"
          >
            {branches.map((b) => (
              <div key={b.id}>
                {b.origin.topicTitle && (
                  <p className="mb-2 text-xs text-muted-foreground">
                    {b.origin.topicTitle}
                  </p>
                )}
                <LearningBranchCard branchId={b.id} compact />
              </div>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
