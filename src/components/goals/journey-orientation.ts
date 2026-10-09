export type JourneyOrientationLesson = {
  unitId: string | null;
  title: string;
  summary?: string;
  status: "pending" | "failed" | "ready" | "completed";
};

export function resolveJourneyOrientationLesson(
  goal: {
    overviewCourseStatus?: string | null;
    overviewCourse?: {
      summary?: string;
      units: Array<{
        id: string;
        title: string;
        completedAt?: string | null;
      }>;
    } | null;
  },
  fallbackTitle: string,
): JourneyOrientationLesson {
  const unit = goal.overviewCourse?.units[0];
  const status: JourneyOrientationLesson["status"] = unit?.completedAt
    ? "completed"
    : !unit && goal.overviewCourseStatus === "failed"
      ? "failed"
      : "ready";
  return {
    unitId: unit?.id ?? null,
    title: fallbackTitle,
    summary: goal.overviewCourse?.summary,
    status,
  };
}
