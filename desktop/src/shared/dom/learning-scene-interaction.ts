/** SVG icons bubble events too; HTMLElement excludes paths inside buttons. */
export function isLearningSceneControlTarget(
  target: EventTarget | null,
): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "button, a, input, textarea, select, form, [data-course-chat], [role='button'], [contenteditable='true'], [data-highlight-interactive='true']",
      ),
    )
  );
}
