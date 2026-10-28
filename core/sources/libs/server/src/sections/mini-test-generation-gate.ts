/** Authoring a test requires teaching material; taking it also requires reading progress. */
export function assertMiniTestGenerationReady(
  sections: ReadonlyArray<{
    generationStatus?: unknown;
    material?: unknown;
    progress?: ReadonlyArray<{
      status?: unknown;
      contentCompletedAt?: unknown;
    }>;
  }>,
  purpose?: "course-production",
): void {
  if (purpose === "course-production") {
    if (
      !sections.length ||
      sections.some(
        (section) => section.generationStatus !== "ready" || !section.material,
      )
    ) {
      throw new Error(
        "Generate all teaching material in this checkpoint before producing its test",
      );
    }
    return;
  }
  if (
    sections.some((section) => {
      const progress = section.progress?.[0];
      return (
        progress?.status !== "skipped" &&
        !progress?.contentCompletedAt &&
        progress?.status !== "completed"
      );
    })
  )
    throw new Error("Complete all learning sections in this checkpoint first");
}
