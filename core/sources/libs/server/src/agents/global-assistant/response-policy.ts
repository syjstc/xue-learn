export function shouldStopAfterToolUi(
  toolName: string,
  result: unknown,
  renderedUi: boolean,
): boolean {
  if (renderedUi && toolName === "get_active_goal_creation") {
    return true;
  }
  return Boolean(
    renderedUi &&
      toolName === "create_goal" &&
      result &&
      typeof result === "object" &&
      (result as { suggested?: boolean }).suggested === true,
  );
}
