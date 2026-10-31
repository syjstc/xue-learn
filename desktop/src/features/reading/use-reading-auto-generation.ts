import { useEffect, useRef } from "react";
import type { ReadingCourse } from "@xue-learn/core/domain/reading-document";

/** Start a missing chapter once after its saved state has loaded. A failed or
 * stopped job stays under the learner's control instead of retrying on render. */
export function useReadingAutoGeneration({ active, loaded, pending, unitId, section, generate }: {
  active: boolean;
  loaded: boolean;
  pending: boolean;
  unitId: string;
  section?: ReadingCourse["sections"][number];
  generate: () => void;
}) {
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    if (!active || !loaded || pending || !section || section.reading) return;
    const key = JSON.stringify([unitId, section.id]);
    if (attempted.current.has(key)) return;
    // Mark before starting: Strict Mode and query updates must not submit twice.
    attempted.current.add(key);
    generate();
  }, [active, loaded, pending, unitId, section, generate]);
}
