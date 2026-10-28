export function pythonConsoleStreamClass(
  stream: "stdout" | "stderr" | "result" | "system" | "stdin",
): string {
  switch (stream) {
    case "stderr":
      return "text-[var(--course-content-code-syntax-deletion)]";
    case "result":
      return "text-[var(--course-content-code-syntax-type)]";
    case "system":
      return "italic text-[var(--course-content-code-muted)]";
    case "stdin":
      return "text-[var(--course-content-code-syntax-string)]";
    default:
      return "text-[var(--course-content-code-text)]";
  }
}
