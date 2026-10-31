import {useCallback, useEffect, useId, useRef, useState} from "react";
import {supportsMaterialFollowUps} from "@xue-learn/core/client-runtime";
import {anchorId, type MaterialAnchor} from "@xue-learn/core/shared/domain/material-anchor";
import {useAssistant} from "@/components/agent/assistant-provider";
import {useMaterialFollowUps} from "@/hooks/use-material-follow-ups";
import {observeReadingFollowUpHighlights} from "./reading-follow-up-highlight";

/** Reading owns its quotes and document versions; Display block offsets do not apply. */
export function useReadingFollowUp({unitId, sectionId, goalId, documentId, enabled}: {
  unitId: string; sectionId: string; goalId?: string; documentId?: string; enabled: boolean;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const rangeRef = useRef<Range | null>(null);
  const [anchor, setAnchor] = useState<MaterialAnchor | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<MaterialAnchor | null>(null);
  const ownerId = useId();
  const {openUnitFollowUp, closeUnitFollowUp} = useAssistant();
  const available = enabled && Boolean(documentId) && supportsMaterialFollowUps();
  const {threads} = useMaterialFollowUps(unitId, {enabled: available});

  const clear = useCallback(() => {
    setAnchor(null);
    rangeRef.current = null;
    const selection = window.getSelection();
    if (selection && containerRef.current?.contains(selection.anchorNode))
      selection.removeAllRanges();
  }, []);

  useEffect(() => {
    clear();
    setPendingAnchor(null);
    return () => closeUnitFollowUp(ownerId);
  }, [unitId, sectionId, documentId, available, clear, closeUnitFollowUp, ownerId]);

  useEffect(() => {
    if (pendingAnchor && threads.some(thread => anchorId(thread.anchor) === anchorId(pendingAnchor)))
      setPendingAnchor(null);
  }, [threads, pendingAnchor]);

  useEffect(() => {
    const root = containerRef.current;
    if (!available || !root) return;
    const anchors = [...threads.map(thread => thread.anchor), ...(pendingAnchor ? [pendingAnchor] : [])]
      .filter(anchor => anchor.sectionId === sectionId && anchor.reading?.documentId === documentId);
    return observeReadingFollowUpHighlights(root, anchors);
  }, [available, sectionId, documentId, threads, pendingAnchor]);

  useEffect(() => {
    if (!available || !documentId) return;
    let frame = 0, selecting = false;
    const process = () => {
      const root = containerRef.current, selection = window.getSelection();
      if (!root || root.closest("[hidden]") || !selection || selection.isCollapsed ||
          !selection.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
        rangeRef.current = null;
        setAnchor(null);
        return;
      }
      const range = selection.getRangeAt(0), text = selection.toString().trim();
      const start = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement : range.startContainer as Element;
      const block = start?.closest<HTMLElement>("[data-reading-block]");
      if (!text || !block || !root.contains(block)) {
        rangeRef.current = null;
        setAnchor(null);
        return;
      }
      const prefix = range.cloneRange();
      prefix.selectNodeContents(block);
      prefix.setEnd(range.startContainer, range.startOffset);
      const offset = prefix.toString().length;
      const blockId = block.dataset.readingBlock!;
      rangeRef.current = range.cloneRange();
      setAnchor({
        scope: "block", sectionId, reading: {documentId, blockId},
        blockKey: `reading:${documentId}:${blockId}`,
        subPath: "text.selection", selectedText: text,
        textRange: {start: offset, end: offset + range.toString().length},
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {if (!selecting) process();});
    };
    const down = () => {selecting = true;};
    const up = () => {selecting = false; schedule();};
    const keydown = (event: KeyboardEvent) => {if (event.key === "Escape") clear();};
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    document.addEventListener("selectionchange", schedule);
    document.addEventListener("keydown", keydown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("keydown", keydown);
    };
  }, [available, documentId, sectionId, clear]);

  const getAnchorRect = useCallback(() => {
    const range = rangeRef.current;
    if (!range || !containerRef.current?.contains(range.startContainer)) return null;
    return Array.from(range.getClientRects()).find(rect => rect.width > 0 && rect.height > 0) ?? null;
  }, []);
  const ask = useCallback(() => {
    if (!available || !anchor) return;
    const existing = threads.find(thread => anchorId(thread.anchor) === anchorId(anchor));
    setPendingAnchor(anchor);
    openUnitFollowUp(unitId, ownerId, {goalId: goalId ?? "", anchor, threadId: existing?.id});
    clear();
  }, [available, anchor, threads, openUnitFollowUp, unitId, ownerId, goalId, clear]);

  return {containerRef, anchor: available ? anchor : null, getAnchorRect, ask, clear};
}
