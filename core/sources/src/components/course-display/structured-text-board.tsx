import type { MaterialCodePart } from "../../../libs/domain/src/index.js";
import { cn } from "../../shared/utils.js";

/** JSON-like examples are literal source, not independent Markdown paragraphs.
 * Cue partitions may split a key, its colon, or even whitespace. */
export function isStructuredTextBoard(source: string): boolean {
  return /^\s*[\[{]/u.test(source) && /["“][^"”\n]+["”]\s*:/u.test(source);
}

export function StructuredTextBoard({
  parts,
  isLit,
  hasCued,
}: {
  parts: readonly MaterialCodePart[];
  isLit: (part: MaterialCodePart) => boolean;
  hasCued: boolean;
}) {
  return (
    <div className="lp-text-board-literal">
      {parts.map((part, index) => {
        const lit = isLit(part);
        return (
          <span
            key={`${part.id ?? "part"}:${index}`}
            className={cn(
              "lp-text-board-fragment",
              lit && "is-cued",
              hasCued && !lit && "is-dimmed",
            )}
            data-lp-lit={lit ? "true" : undefined}
            data-lp-part-id={part.id}
            data-lp-source-text={part.text}
          >
            {part.text}
          </span>
        );
      })}
    </div>
  );
}
