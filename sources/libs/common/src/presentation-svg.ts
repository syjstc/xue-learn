const FORBIDDEN = [
  "<animate",
  "<animatetransform",
  "<set",
  "foreignobject",
  "<script",
  "onload=",
  "onclick=",
  "onbegin=",
  'xlink:href="http',
  'href="http',
];

export function validatePresentationSvg(markup: string): readonly string[] {
  const issues: string[] = [];
  const lower = markup.toLowerCase();
  if (!lower.includes("<svg")) {
    issues.push("not_svg");
    return issues;
  }
  for (const token of FORBIDDEN) {
    if (lower.includes(token)) issues.push(`forbidden:${token}`);
  }
  if (
    /animation\s*:/i.test(markup) ||
    /@keyframes/i.test(markup) ||
    /transition\s*:/i.test(markup)
  ) {
    issues.push("forbidden:css_animation");
  }
  return issues;
}
