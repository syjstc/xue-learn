import { existsSync } from "node:fs";
import { join } from "node:path";

const COURSE_SVG_FONT_FILENAMES = [
  "NotoSansSC_400Regular.ttf",
  "NotoSansSC_700Bold.ttf",
] as const;

/**
 * resvg must not inherit the host's font set: a browser and the packaged
 * sidecar otherwise choose different CJK fallback glyphs and text metrics.
 */
export function resolveCourseSvgFontFiles(): string[] {
  const configuredRoot = process.env.XUELEARN_SVG_FONT_DIR?.trim();
  const roots = [
    configuredRoot,
    join(process.cwd(), "fonts"),
  ].filter((value): value is string => Boolean(value));

  for (const root of roots) {
    const files = COURSE_SVG_FONT_FILENAMES.map((filename) =>
      join(root, filename),
    );
    if (files.every(existsSync)) return files;
  }
  // Mobile subsets omit punctuation and less common glyphs. Static exports need
  // the full OFL font already installed with the workspace's font package.
  try {
    const files = [
      require.resolve("@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf"),
      require.resolve("@expo-google-fonts/noto-sans-sc/700Bold/NotoSansSC_700Bold.ttf"),
    ];
    if (files.every(existsSync)) return files;
  } catch { /* Packaged execution must provide the fonts directory above. */ }
  throw new Error(
    "Bundled Noto Sans SC fonts are required for deterministic SVG rendering",
  );
}
