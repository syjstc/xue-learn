"use client";

import type { MaterialFigureCaption } from "@xue-learn/core/domain";

export function MaterialFigureCaptions({
  captions,
}: {
  captions: readonly MaterialFigureCaption[];
}) {
  if (captions.length === 0) return null;
  return (
    <div className="material-figure-captions mt-2 space-y-1 text-sm leading-6 text-[var(--course-content-muted)]">
      {captions.map((caption) => (
        <p key={caption.paragraphIndex}>{caption.text}</p>
      ))}
    </div>
  );
}
