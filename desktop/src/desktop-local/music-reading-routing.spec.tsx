import { renderToStaticMarkup } from "react-dom/server";
import { CourseBoardContent } from "@xue-learn/core/display/course-board-content";
import { I18nProvider } from "@xue-learn/core/i18n";
import type { CourseDisplayBlock } from "@xue-learn/core/domain/course-display";
import samples from "@/shared/dev/music-teaching.json";
import legacy from "@xue-learn/core/fixtures/music-integration/topic.json";

jest.mock("@xue-learn/core/components/markdown/prose-markdown", () => ({
  ProseMarkdown: ({ content }: { content: string }) => <span>{content}</span>,
}));

const teaching = samples.samples[0]!.material.blocks.find(
  (block) => block.type === "music",
)! as CourseDisplayBlock;

function render(
  block: CourseDisplayBlock,
  mode: "chat" | "classroom" = "chat",
  nested = false,
) {
  // The real reading fallback re-enters MaterialBlockView, which sends music
  // back to CourseChatBoard. Fail immediately here instead of hanging Jest.
  const fallback = jest.fn(() => {
    throw new Error("Music re-entered the reading fallback");
  });
  const html = renderToStaticMarkup(
    <I18nProvider initialLocalePreference="zh-Hans">
      <CourseBoardContent
        mode={mode}
        scene={{
          templateId: nested ? "content.stage" : "content.media",
          title: "",
          slots: { mediaKind: "music" },
        }}
        mediaBlock={
          nested
            ? {
                type: "stage",
                id: "board",
                layout: "split-h",
                figures: [block],
              }
            : block
        }
        renderMedia={fallback}
      />
    </I18nProvider>,
  );
  expect(fallback).not.toHaveBeenCalled();
  return html;
}

describe("music reading routing", () => {
  it.each([false, true])("renders V2 natively (nested=%s)", (nested) => {
    const html = render(teaching, "chat", nested);
    expect(html).toContain('data-music-version="2"');
    expect(html).toContain("music-teaching-canvas");
    expect(html).toContain("music-controls");
  });

  it.each([false, true])(
    "keeps classroom V2 controls hidden (nested=%s)",
    (nested) => {
      const html = render(teaching, "classroom", nested);
      expect(html).toContain('data-music-version="2"');
      expect(html).not.toContain("music-controls");
    },
  );

  it("renders the first silent teaching draft without requiring clips", () => {
    const { clips: _clips, ...silent } = teaching;
    expect(render(silent)).toContain('data-music-version="2"');
  });

  it.each([false, true])(
    "preserves legacy music playback (nested=%s)",
    (nested) => {
      expect(render(legacy.display, "chat", nested)).toContain(
        'aria-label="播放进度"',
      );
    },
  );

  it.each([false, true])(
    "shows an incomplete/unknown music block without recursion (nested=%s)",
    (nested) => {
      const incomplete = { type: "music", version: 2, id: "pending" };
      expect(render(incomplete, "chat", nested)).toContain('role="status"');
      expect(render({ ...incomplete, version: 99 }, "chat", nested)).toContain(
        "音乐内容暂时无法显示",
      );
    },
  );
});
