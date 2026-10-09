import { buildGoalTextbookHtml } from "./goal-textbook-html.js";
import type { GoalTextbook } from "./goal-textbook-model.js";
import type { GoalTextbookPdfLayout } from "./pdf-layout.js";
import { renderHtmlToPdf } from "./pdf-browser.js";
import { resolveMaterialImagesForPdf } from "./pdf-images.js";
import { randomUUID } from "node:crypto";
import { writeAigcPdfMetadata } from "../aigc/pdf-metadata.js";

const PDF_PAGE_PRESETS = {
  desktop: {
    format: "A4" as const,
    margin: { top: "48px", bottom: "56px", left: "48px", right: "48px" },
    footerPaddingX: "48px",
  },
  mobile: {
    width: "390px",
    height: "844px",
    margin: { top: "20px", bottom: "34px", left: "20px", right: "20px" },
    footerPaddingX: "20px",
  },
} satisfies Record<
  GoalTextbookPdfLayout,
  Parameters<typeof renderHtmlToPdf>[1]["page"]
>;

async function prepareGoalTextbookForPdf(
  book: GoalTextbook,
): Promise<GoalTextbook> {
  const sections = await Promise.all(
    book.sections.map(async (section) => {
      if (section.kind !== "lesson" || !section.material) return section;
      const lesson = section;
      const material = await resolveMaterialImagesForPdf(
        lesson.unitId,
        section.material,
      );
      return { ...lesson, material };
    }),
  );
  return { ...book, sections };
}

export async function renderGoalTextbookPdf(
  book: GoalTextbook,
  options: { layout?: GoalTextbookPdfLayout } = {},
): Promise<Buffer> {
  const layout = options.layout ?? "desktop";
  const prepared = await prepareGoalTextbookForPdf(book);
  const html = buildGoalTextbookHtml(prepared, { layout });
  const pdf = await renderHtmlToPdf(html, {
    title: prepared.goal.title,
    page: PDF_PAGE_PRESETS[layout],
  });
  return writeAigcPdfMetadata(pdf, randomUUID());
}
