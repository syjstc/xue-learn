/** Short catalog label for the orientation lesson — never the goal title or an English "overview" suffix. */
export function overviewLessonTitle(contentLanguage: string): string {
  const code = contentLanguage.trim().toLowerCase();
  if (
    code.startsWith("zh-hant") ||
    code.startsWith("zh-tw") ||
    code.startsWith("zh-hk")
  ) {
    return "課程導覽";
  }
  if (code.startsWith("zh")) return "课程导览";
  return "Course orientation";
}

export function withOverviewLessonTitle(
  _title: string,
  contentLanguage: string,
): string {
  return overviewLessonTitle(contentLanguage);
}

export function sectionAuthoringUnitTitle(
  unitTitle: string,
  sectionTitle: string,
): string {
  const unit = unitTitle.trim();
  const section = sectionTitle.trim();
  if (!section || unit === section) return unit;
  return `${unit} · ${section}`;
}
