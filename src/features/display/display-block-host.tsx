import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject} from "react";
import {materialDisplayDocument, derivationDisplayDurationTicks, projectDisplayFocusTimeline} from "@xue-learn/core/display/catalog";
import {createDisplayClock, DisplayPlaceholder, type DisplayClock, type DisplayDocument, type DisplayNode} from "@xue-learn/core/display/runtime";
import {WorkspaceDisplaySurface} from "@xue-learn/core/display/workspace";
import {parseTeachingDerivationDocument} from "@xue-learn/core/teaching-derivation";
import {materialStageFocusIndexes, type CourseDisplayBlock} from "@xue-learn/core/domain";
import type {CourseBoardPlayback} from "@/components/course-display/course-chat-board";
import {useBoardFocusVisibility} from "@/components/course-display/use-board-focus-visibility";
import "./chat-display.css";

const EMPTY_TARGETS: readonly string[] = [];
const FPS = 60;
const CUE_TRANSITION_SECONDS = .7;
// Shared artwork has finished entering before the message emphasis begins.
const CUE_START_SECONDS = 2;

function stageBlock(block: unknown) {
  const stage = block as CourseDisplayBlock | undefined;
  return stage?.type === "stage" && Array.isArray(stage.figures) ? stage : undefined;
}

/** A stage cue selects a figure; only that figure consumes its local targets. */
function projectStageCues(document: DisplayDocument, block: unknown, targets: readonly string[], previous: readonly string[], revealed?: readonly string[]): DisplayDocument {
  const stage = stageBlock(block);
  if (!stage || !document.root.children) return document;
  const figures = stage.figures as CourseDisplayBlock[];
  const local = (ids: readonly string[], index: number) => ids.flatMap(target => {
    const prefix = `fig:${figures[index]?.id}:`;
    if (target.startsWith(prefix)) return [target.slice(prefix.length)];
    if (target.startsWith("fig:")) return [];
    const focused = materialStageFocusIndexes({layout: String(stage.layout), figures, targetIds: [target]});
    return focused.length ? focused.includes(index) ? ["whole"] : [] : [target];
  });
  return {...document, root: {...document.root, children: document.root.children.map((node, index) => ({...node,
    payload: {...(node.payload as object), activeTargetIds: local(targets, index), previousActiveTargetIds: local(previous, index), revealedTargetIds: revealed && local(revealed, index)},
  }))}};
}

function useChatStageFocus(root: RefObject<HTMLDivElement | null>, block: unknown, targets: readonly string[], enabled: boolean) {
  const stage = stageBlock(block);
  const key = enabled && stage ? targets.join("\n") : "";
  useLayoutEffect(() => {
    const host = root.current;
    if (!host || !stage || !enabled) return;
    const focused = materialStageFocusIndexes({layout: String(stage.layout), figures: stage.figures as CourseDisplayBlock[], targetIds: targets});
    const update = () => {
      const composition = host.querySelector(".display-film-composition");
      if (!composition) return;
      [...composition.children].forEach((child, index) => {
        child.setAttribute("data-stage-index", String(index));
        child.setAttribute("data-focused", String(focused.includes(index)));
      });
    };
    update();
    // Plugin artwork may arrive asynchronously after the host has mounted.
    const observer = new MutationObserver(update);
    observer.observe(host, {childList: true, subtree: true});
    return () => observer.disconnect();
  }, [root, block, key, enabled]);
  useBoardFocusVisibility(root, key);
}
function displayNodes(root: unknown): DisplayNode[] {
  const queue: unknown[] = [root], visited = new Set<object>(), result: DisplayNode[] = [];
  while (queue.length && result.length < 10_000) {
    const value = queue.pop();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    const node = value as DisplayNode;
    result.push(node);
    const enqueue = (children: readonly unknown[]) => {
      const remaining = Math.max(0, 10_000 - result.length - queue.length);
      for (let index = 0; index < Math.min(children.length, remaining); index++) queue.push(children[index]);
    };
    if (Array.isArray(node.children)) enqueue(node.children);
    if (node.slots && typeof node.slots === "object") for (const children of Object.values(node.slots)) if (Array.isArray(children)) enqueue(children);
  }
  return result;
}

/** Preview estimation is bounded and never interprets a legacy formal document as teaching-v1 data. */
export function estimateDisplayDuration(document: DisplayDocument): number {
  const ticksPerSecond = Number.isFinite(document?.ticksPerSecond) && Number(document.ticksPerSecond) > 0 ? document.ticksPerSecond! : 48_000;
  if (Number.isFinite(document?.durationTicks) && Number(document.durationTicks) >= 0) return Math.max(1 / FPS, document.durationTicks! / ticksPerSecond);
  let duration = 0;
  for (const cue of Array.isArray(document?.timeline) ? document.timeline : []) {
    if (cue && Number.isFinite(cue.startTick) && Number.isFinite(cue.durationTicks) && cue.startTick >= 0 && cue.durationTicks > 0) duration = Math.max(duration, (cue.startTick + cue.durationTicks) / ticksPerSecond);
  }
  for (const node of displayNodes(document?.root)) {
    if (node.kind !== "math:derivation") continue;
    try {
      const payload = node.payload as {document?: unknown} | undefined;
      const derivation = parseTeachingDerivationDocument(payload?.document);
      if (derivation) duration = Math.max(duration, derivationDisplayDurationTicks(derivation) / 48_000);
    } catch { /* Malformed data is reported by the shared display placeholder. */ }
  }
  return duration > 0 && Number.isFinite(duration) ? duration : 12;
}

/** A learning host supplies time and controls; all artwork is shared with Video. */
export function DisplayDocumentHost({document, clock: controlledClock, autoPlay = false, playbackKey, controls = true, presentation = "preview"}: {
  document: DisplayDocument; clock?: DisplayClock; autoPlay?: boolean; playbackKey?: string; controls?: boolean; presentation?: "preview" | "chat";
}) {
  const [resolved, setResolved] = useState<{source: DisplayDocument; document: DisplayDocument}>();
  const currentDocument = resolved?.source === document ? resolved.document : document;
  const duration = useMemo(() => controlledClock ? 12 : estimateDisplayDuration(currentDocument), [controlledClock, currentDocument]);
  const pending = useMemo(() => displayNodes(currentDocument?.root).some(node => node.build && ["pending", "running"].includes(node.build.status)), [currentDocument]);
  const [frame, setFrame] = useState(autoPlay ? 0 : Math.min(120, Math.max(0, Math.ceil(duration * FPS) - 1)));
  const frameRef = useRef(frame);
  const [playing, setPlaying] = useState(autoPlay);
  const [seek, setSeek] = useState(0);
  const durationFrames = Math.max(1, Math.ceil(duration * FPS));
  const identity = `${document?.id ?? "invalid"}:${playbackKey ?? ""}`;
  const seekTo = (next: number) => {frameRef.current = Math.max(0, Math.min(durationFrames - 1, Number.isFinite(next) ? next : 0)); setFrame(frameRef.current); setSeek(value => value + 1);};
  const onDocumentResolved = useCallback((next: DisplayDocument) => setResolved({source: document, document: next}), [document]);
  useEffect(() => {frameRef.current = autoPlay ? 0 : Math.min(120, durationFrames - 1); setFrame(frameRef.current); setPlaying(autoPlay);}, [identity, autoPlay]);
  useEffect(() => {
    if (frameRef.current > durationFrames - 1) {frameRef.current = durationFrames - 1; setFrame(frameRef.current);}
  }, [durationFrames]);
  useEffect(() => {
    if (!playing || controlledClock || pending) return;
    let handle = 0;
    const start = performance.now(), initial = frameRef.current;
    const advance = (now: number) => {
      const next = Math.min(durationFrames - 1, initial + (now - start) * FPS / 1000);
      frameRef.current = next; setFrame(next);
      if (next < durationFrames - 1) handle = requestAnimationFrame(advance); else setPlaying(false);
    };
    handle = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(handle);
  }, [playing, identity, durationFrames, seek, controlledClock, pending]);
  const clock = controlledClock ?? createDisplayClock(Math.min(frame, durationFrames - 1), FPS, {playing: playing && !pending, ticksPerSecond: Number.isSafeInteger(currentDocument?.ticksPerSecond) && Number(currentDocument.ticksPerSecond) > 0 ? currentDocument.ticksPerSecond : 48_000});
  return <div className="desktop-display-host" data-unified-display="true" data-display-presentation={presentation}>
    <WorkspaceDisplaySurface document={document} clock={clock} mode="interactive" onDocumentResolved={onDocumentResolved}/>
    {controls && !controlledClock ? <div className="workspace-display-controls">
      <button type="button" aria-label={playing ? "暂停演示" : "播放演示"} onClick={() => {if (frameRef.current >= durationFrames - 1) seekTo(0); setPlaying(value => !value);}}>{playing ? "暂停" : "播放演示"}</button>
      <input type="range" aria-label="演示进度" min={0} max={durationFrames - 1} step={1} disabled={pending} value={Math.min(Math.round(frame), durationFrames - 1)} onChange={event => seekTo(Number(event.target.value))}/>
      <span>{Math.floor(clock.timeSeconds)} / {Math.ceil(duration)} 秒</span>
    </div> : null}
  </div>;
}

function useCueProgress(identity: string, targets: readonly string[], animate: boolean, cueId?: string) {
  const key = `${identity}:${cueId??''}:${[...targets].sort().join("\n")}`;
  const previous = useRef<{identity: string; key: string; targets: readonly string[]} | undefined>(undefined);
  const [sample, setSample] = useState<{key: string; previous: readonly string[]; progress: number}>({key, previous: EMPTY_TARGETS, progress: 1});
  useLayoutEffect(() => {
    if (previous.current?.key === key) {if (!animate) setSample(current => current.progress === 1 ? current : {...current, progress: 1}); return;}
    const before = previous.current?.identity === identity ? previous.current.targets : EMPTY_TARGETS;
    previous.current = {identity, key, targets: [...targets]};
    if (!animate || !targets.length || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {setSample({key, previous: before, progress: 1}); return;}
    let handle = 0;
    const started = performance.now();
    setSample({key, previous: before, progress: 0});
    const advance = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - started) / (CUE_TRANSITION_SECONDS * 1000)));
      setSample({key, previous: before, progress});
      if (progress < 1) handle = requestAnimationFrame(advance);
    };
    handle = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(handle);
  }, [key, identity, animate]);
  return sample.key === key ? sample : {key, previous: previous.current?.identity === identity ? previous.current.targets : EMPTY_TARGETS, progress: animate ? 0 : 1};
}

export function DisplayBlockHost({block, id, activeTargetIds = EMPTY_TARGETS, playback}: {
  block: unknown; id?: string; activeTargetIds?: readonly string[]; playback?: CourseBoardPlayback;
}) {
  const identity = id ?? (block && typeof block === "object" && typeof (block as {id?: unknown}).id === "string" ? (block as {id: string}).id : "material-display");
  const motion = useCueProgress(identity, activeTargetIds, playback?.animate ?? false, playback?.cueId);
  const root = useRef<HTMLDivElement>(null);
  useChatStageFocus(root, block, activeTargetIds, Boolean(playback));
  const adapted = useMemo(() => {
    try {
      const document = materialDisplayDocument(block, {id, ...(activeTargetIds.length || playback ? {activeTargetIds, previousActiveTargetIds: motion.previous, revealedTargetIds: playback?.revealedTargetIds, progress: motion.progress} : {})});
      // Portable documents already use public node/target paths. Replace their
      // authored video timeline with the focused message's cues in this host only.
      if (playback && block && typeof block === "object" && (block as {type?: unknown}).type === "display") {
        const hasAuthoredCue = playback.cueId ? document.timeline?.some(cue => cue.id === playback.cueId)
          : document.timeline?.some(cue => cue.targets.some(target => activeTargetIds.includes(target)));
        if (!hasAuthoredCue && activeTargetIds.length) {
          const ticksPerSecond = document.ticksPerSecond ?? 48_000;
          return {document: {...document, timeline: [
            {id: 'chat-previous', startTick: 0, durationTicks: CUE_START_SECONDS * ticksPerSecond, targets: motion.previous},
            {id: 'chat-focus', startTick: CUE_START_SECONDS * ticksPerSecond, durationTicks: ticksPerSecond, targets: activeTargetIds},
          ]}};
        }
        return {document: projectDisplayFocusTimeline(document, activeTargetIds, playback.cueId, CUE_START_SECONDS, CUE_TRANSITION_SECONDS)};
      }
      return {document: playback ? projectStageCues(document, block, activeTargetIds, motion.previous, playback.revealedTargetIds) : document};
    }
    catch (error) {return {error};}
  }, [block, id, activeTargetIds, motion.previous, motion.progress, playback?.revealedTargetIds, playback?.cueId, Boolean(playback)]);
  // Chat advances only this short focus transition, then holds its final state.
  // Standalone previews retain their own playback clock and controls.
  const clock = playback && adapted.document ? createDisplayClock(
    (CUE_START_SECONDS + CUE_TRANSITION_SECONDS * motion.progress) * FPS,
    FPS,
    {playing: motion.progress < 1, ticksPerSecond: Number.isSafeInteger(adapted.document.ticksPerSecond) && Number(adapted.document.ticksPerSecond) > 0 ? adapted.document.ticksPerSecond : 48_000},
  ) : undefined;
  return <div ref={root} className="desktop-display-block">{adapted.document ? <DisplayDocumentHost document={adapted.document} clock={clock} controls={!playback} presentation={playback ? "chat" : "preview"}/>
    : <DisplayPlaceholder failure={{reason: "invalid-document", message: "This saved display could not be adapted", error: adapted.error}}/>}</div>;
}
