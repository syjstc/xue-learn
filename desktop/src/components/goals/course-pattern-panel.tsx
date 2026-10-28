"use client";

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
      setError(e instanceof Error ? e.message : "保存课程模式失败");
    }
  }

  async function handleRegenerate() {
    const ok = await confirm({
      title: "重新生成课程模式",
      description:
        "将根据当前目标信息重新生成课程模式，并覆盖现有内容。确定继续吗？",
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
      setError(e instanceof Error ? e.message : "重新生成课程模式失败");
    }
  }

  return (
    <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
      <CardTitle>课程模式</CardTitle>
      <p className="mt-2 text-sm text-muted-foreground">
        课程模式定义相似学习单元的固定结构、内容块用法，以及共享背景（如作者、朝代、语法体系）应如何复用。
        后续生成预习与正文时会遵循此模式。
      </p>

      <div className="mt-4 space-y-1.5">
        <Label htmlFor={`course-pattern-${goalId}`}>模式内容</Label>
        <Textarea
          id={`course-pattern-${goalId}`}
          className="min-h-[220px] resize-y font-mono text-xs"
          value={coursePattern}
          disabled={busy}
          placeholder="尚未生成课程模式。可先保存自定义内容，或点击「重新生成」。"
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
          {updateGoalSettings.isPending ? "保存中…" : "保存"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void handleRegenerate()}
        >
          {regenerateCoursePattern.isPending ? "生成中…" : "重新生成"}
        </Button>
      </div>
    </Card>
  );
}
