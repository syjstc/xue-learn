import { useEffect, useState } from "react";
import type { LearningMaterialContent } from "@xue-learn/core/schemas";
import { isDesktopLocalRuntime } from "@xue-learn/core/client-runtime";
import {
  clearLearningReturn,
  pendingLearningReturn,
  restoreReadingPosition,
} from "./navigation.ts";
/** Observe the material mount only; this never drives generation or mastery. */
export function useReadingLearningReturn(
  unitId: string,
  sectionId: string,
  material: LearningMaterialContent,
) {
  const [returnRevision,setReturnRevision]=useState(0);
  useEffect(()=>{
    const queued=(event:Event)=>{if ((event as CustomEvent<string>).detail === unitId) setReturnRevision(n=>n+1);};
    window.addEventListener('learning-return-queued',queued);
    return ()=>window.removeEventListener('learning-return-queued',queued);
  },[unitId]);
  useEffect(() => {
    if (!isDesktopLocalRuntime()) return;
    const position = pendingLearningReturn(unitId);
    if (
      !position ||
      position.mode !== "reading" ||
      (position.sectionId && position.sectionId !== sectionId)
    )
      return;
    const root = document.querySelector<HTMLElement>(
      `[data-learning-section="${CSS.escape(sectionId)}"]`,
    );
    if (!root) return;
    let done = false;
    const restore = () => {
      if (done) return;
      const result = restoreReadingPosition(root, material, position);
      if (!result.restored) return;
      done = true;
      clearLearningReturn(unitId);
      if (!result.exact)
        window.dispatchEvent(new CustomEvent("learning-return-adjusted"));
    };
    const observer = new MutationObserver(restore);
    observer.observe(root, { childList: true, subtree: true });
    const frame = requestAnimationFrame(restore);
    const timeout = setTimeout(() => {
      if (!done) {
        root.scrollIntoView({ block: "start" });
        clearLearningReturn(unitId);
        window.dispatchEvent(new CustomEvent("learning-return-adjusted"));
      }
      observer.disconnect();
    }, 5000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
      observer.disconnect();
    };
  }, [unitId, sectionId, material, returnRevision]);
}
