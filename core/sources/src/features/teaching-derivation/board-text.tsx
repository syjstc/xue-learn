import katex from "katex";
import { KATEX_MACROS } from "../../shared/markdown/katex-macros.js";

/** Tiny text/math renderer: no markdown layout/chrome or unsafe HTML on stage. */
export function BoardText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\$\$[\s\S]*?\$\$|\$[^$]+\$|\\\([\s\S]*?\\\))/g)
        .map((part, index) => {
          const math = part.startsWith("$") || part.startsWith("\\(");
          if (!math) return <span key={index}>{part}</span>;
          const latex = part.startsWith("$$")
            ? part.slice(2, -2)
            : part.startsWith("\\(")
              ? part.slice(2, -2)
              : part.slice(1, -1);
          return (
            <span
              key={index}
              dangerouslySetInnerHTML={{
                __html: katex.renderToString(latex, {
                  throwOnError: false,
                  strict: "ignore",
                  trust: false,
                  macros: KATEX_MACROS,
                }),
              }}
            />
          );
        })}
    </>
  );
}
