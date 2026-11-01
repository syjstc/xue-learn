"use client";
import { useT } from "@xue-learn/core/i18n";

import { useEffect, useState } from "react";
import { Button } from "@xue-learn/core/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useGoal,
  useInvalidateGoal,
  useRegenerateGoalCoursePattern,
  useUpdateGoalSettings,
} from "@/hooks/api";
import { useConfirm } from "@/hooks/use-confirm";
import { extractGoalCoursePattern } from "@/shared/domain/goal-course-pattern";
import { FEATURE_COURSE_PATTERN } from "@xue-learn/core/features";
import { supportsGoalMapAuthoring } from "@xue-learn/core/client-runtime";

export function CoursePatternPanel({ goalId }: { goalId: string }) {
  const t = useT();
  // Course-pattern editing is part of the hosted legacy map-authoring
  // contract. Local SQLite intentionally has no route/persistence authority
  // for this field, so do not render controls that can only fail at submit.
  if (!FEATURE_COURSE_PATTERN || !supportsGoalMapAuthoring()) return null;
  const { data: goal } = useGoal(goalId);
  const invalidateGoal = useInvalidateGoal();
  const updateGoalSettings = useUpdateGoalSettings();
  const regenerateCoursePattern = useRegenerateGoalCoursePattern();
  const { confirm } = useConfirm();
  const [coursePattern, setCoursePattern] = useState("");
  const [error, setError] = useState("");
  const [savedPattern, setSavedPattern] = useState("");

  useEffect(() => {
    const next = extractGoalCoursePattern(goal?.generationOptions);
    setCoursePattern(next);
    setSavedPattern(next);
  }, [goal?.generationOptions]);

  const dirty = coursePattern !== savedPattern;
  const busy =
    updateGoalSettings.isPending || regenerateCoursePattern.isPending;

  async function handleSave() {
    setError("");
    try {
      const data = await updateGoalSettings.mutateAsync({
        goalId,
        coursePattern,
      });
      const next = data.coursePattern ?? coursePattern;
      setCoursePattern(next);
      setSavedPattern(next);
      await invalidateGoal(goalId);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("desktop.i18n.patternSaveFailed"),
      );
    }
  }

  async function handleRegenerate() {
    const ok = await confirm({
      title: t("desktop.i18n.patternRegenerate"),
      description: t("desktop.i18n.patternRegenerateConfirm"),
      variant: "destructive",
    });
    if (!ok) return;

    setError("");
    try {
      setCoursePattern("");
      const data = await regenerateCoursePattern.mutateAsync(goalId);
      const next = data.coursePattern ?? "";
      setCoursePattern(next);
      setSavedPattern(next);
      await invalidateGoal(goalId);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("desktop.i18n.patternRegenerateFailed"),
      );
    }
  }

  return (
    <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
      <CardTitle>{t("wizard.steps.structured.courseMode")}</CardTitle>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("desktop.ui.coursePatternPanel.aCoursePatternDefinesTheStructureOf")}
      </p>

      <div className="mt-4 space-y-1.5">
        <Label htmlFor={`course-pattern-${goalId}`}>
          {t("desktop.ui.coursePatternPanel.patternContent")}
        </Label>
        <Textarea
          id={`course-pattern-${goalId}`}
          className="min-h-[220px] resize-y font-mono text-xs"
          value={coursePattern}
          disabled={busy}
          placeholder={t(
            "desktop.ui.coursePatternPanel.noCoursePatternYetSaveYourOwn",
          )}
          onChange={(e) => setCoursePattern(e.target.value)}
        />
      </div>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || !dirty}
          onClick={() => void handleSave()}
        >
          {updateGoalSettings.isPending
            ? t("billingAdmin.saving")
            : t("common.save")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void handleRegenerate()}
        >
          {regenerateCoursePattern.isPending
            ? t("wizard.steps.common.generating")
            : t("trajectory.retry")}
        </Button>
      </div>
    </Card>
  );
}
