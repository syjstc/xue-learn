import { useT } from "@xue-learn/core/i18n";
import type { UnitWizardModel } from "../unit-wizard/use-unit-wizard";

export function AssessmentReadinessNotice({
  model,
}: {
  model: Pick<
    UnitWizardModel,
    "learningAccess" | "preparingAssessment" | "retryAssessment"
  >;
}) {
  const t = useT();
  const failed =
    model.learningAccess?.modelPhase === "failed" ||
    model.learningAccess?.modelPhase === "stale";
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 text-sm">
      <span className="min-w-0 flex-1">
        {t(
          failed
            ? "wizard.reading.assessmentFailed"
            : "wizard.reading.assessmentLocked",
        )}
      </span>
      {failed ? (
        <button
          type="button"
          className="shrink-0 rounded-lg border border-current/20 px-3 py-1.5 font-medium disabled:opacity-50"
          disabled={model.preparingAssessment}
          onClick={() => void model.retryAssessment()}
        >
          {t(
            model.preparingAssessment
              ? "wizard.reading.assessmentRetrying"
              : "wizard.reading.assessmentRetry",
          )}
        </button>
      ) : null}
    </div>
  );
}
