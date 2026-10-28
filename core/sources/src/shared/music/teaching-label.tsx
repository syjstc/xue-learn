import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import { renderToStaticMarkup } from "react-dom/server";
import { renderKatexHtml } from "../markdown/katex-setup.js";
import { normalizeLatexMathDelimiters } from "../markdown/normalize-latex-math.js";
import "katex/dist/katex.min.css";

type LabelNode = {
  type: string;
  value?: string;
  children?: LabelNode[];
};

function remarkMusicRhythmLabels() {
  // Accepted labels also contain 第{}1拍 and 第{}1{}组第{}3拍.
  // Repair only numeric rhythm prose, after Markdown has separated code/math.
  // Saved music, narration, meaningful braces and TeX groups stay untouched.
  return function visit(node: LabelNode) {
    if (node.type === "text" && node.value) {
      node.value = node.value.replace(
        /(?:第|[·•])(?:\{\s*\})*\s*\d+(?:\.\d+)?(?:\{\s*\})*(?=\s*(?:拍|组|小节))/g,
        (rhythm) => rhythm.replace(/\{\s*\}/g, ""),
      );
    }
    node.children?.forEach(visit);
  };
}

/** The same math normalization and KaTeX as course copy, inside stable SVG labels. */
export function MusicTeachingLabel({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath, remarkMusicRhythmLabels]}
      skipHtml
      allowedElements={["p", "span", "strong", "em", "code", "br"]}
      unwrapDisallowed
      components={{
        p: ({ children }) => <span>{children}</span>,
        code: ({ className, children }) =>
          className?.includes("math") ? (
            <span
              dangerouslySetInnerHTML={{
                __html: renderKatexHtml(String(children), false),
              }}
            />
          ) : (
            <code>{children}</code>
          ),
      }}
    >
      {normalizeLatexMathDelimiters(text)}
    </ReactMarkdown>
  );
}

export function musicTeachingLabelHtml(text: string) {
  return renderToStaticMarkup(<MusicTeachingLabel text={text} />);
}
