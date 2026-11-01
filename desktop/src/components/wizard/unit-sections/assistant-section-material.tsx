import { isLearningSceneControlTarget } from "@/shared/dom/learning-scene-interaction";
import { resolveMusicCue } from "@xue-learn/core/domain";
import type {
  MusicPlaybackState,
  MusicPerformancePlan as TimelineMusicInput,
} from "@xue-learn/core/domain";
import { MusicClipPlayer } from "@xue-learn/core/shared/music/clip-player";
import {
  claimMusicAudio,
  releaseMusicAudio,
} from "@xue-learn/core/shared/music/audio-ownership";
import { MusicTimelineContext } from "@xue-learn/core/display/music-teaching-display";
("use client");

import { Button } from "@xue-learn/core/ui/button";
import { AnchoredLearningMaterial } from "@/components/wizard/anchored-learning-material";
import type {
  MaterialCheckResult,
  VerifiedMaterialAnswerHandler,
} from "@/components/wizard/interactive-material/types";
import { useLearningViewSettings } from "@/hooks/api/use-settings";
import { apiFetch } from "@/shared/api-client";
import {
  chatNarrationAssetMatchesText,
  resolveChatNarrationPlaybackTiming,
  type ChatNarrationAsset,
} from "@/shared/audio/chat-narration";
import {
  assistantCourseBeatIndexForCursor,
  assistantCourseFirstExplanationIndex,
  assistantCourseCursorHandoffStorageKey,
  assistantCourseCursorStorageKey,
  buildAssistantCourseFeed,
  buildAssistantCourseSceneBeats,
  clampAssistantCourseCursor,
  createAssistantCourseCursorHandoff,
  hasAssistantCourseJitBuffer,
  monotonicAssistantCourseCursor,
  resolveAssistantCourseCursorHandoff,
  sceneTopicBlockIndex,
} from "@/shared/domain/assistant-course-feed";
import { resolveAssistantCourseContinueScrollTop } from "@/shared/domain/assistant-course-scroll";
import { personalizeLearnerContent } from "@/shared/domain/learner-text";
import { headingTopicIdentity } from "@/shared/domain/material-topic-identity";
import { useT } from "@xue-learn/core/i18n";
import type { LearningMaterialContent } from "@xue-learn/core/schemas";
import {
  canUseBrowserPersistentStorage,
  supportsChatAudioGeneration,
} from "@xue-learn/core/client-runtime";
import { cn } from "@xue-learn/core/utils";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

const COURSE_SCROLL_BOTTOM_INSET = 24;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function resolveAssistantCourseScrollRoot(
  from: HTMLElement,
): Window | HTMLElement {
  const lane = from.closest(
    ".course-conversation-transcript, .course-conversation-board",
  );
  if (lane instanceof HTMLElement) return lane;
  const scoped = from.closest("[data-immersive-scroll-surface]");
  if (scoped instanceof HTMLElement) {
    const overflowY = window.getComputedStyle(scoped).overflowY;
    if (
      overflowY === "auto" ||
      overflowY === "scroll" ||
      scoped.scrollHeight > scoped.clientHeight + 1
    ) {
      return scoped;
    }
  }
  return window;
}

function measureAssistantCourseScrollGeometry(
  root: Window | HTMLElement,
  turn: HTMLElement,
) {
  const turnRect = turn.getBoundingClientRect();
  if (!(root instanceof HTMLElement)) {
    return {
      scrollY: window.scrollY,
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      turnTop: turnRect.top,
      turnBottom: turnRect.bottom,
    };
  }
  const rootRect = root.getBoundingClientRect();
  return {
    scrollY: root.scrollTop,
    viewportHeight: root.clientHeight,
    documentHeight: root.scrollHeight,
    turnTop: turnRect.top - rootRect.top,
    turnBottom: turnRect.bottom - rootRect.top,
  };
}

function currentAssistantCourseScrollY(root: Window | HTMLElement): number {
  return root instanceof HTMLElement ? root.scrollTop : window.scrollY;
}

function scrollAssistantCourseRoot(
  root: Window | HTMLElement,
  top: number,
  behavior: ScrollBehavior,
) {
  root.scrollTo({ top, behavior });
}

function readCursor(
  key: string,
  turnCount: number,
): { cursor: number; restored: boolean } {
  if (!canUseBrowserPersistentStorage()) {
    return {
      cursor: clampAssistantCourseCursor(1, turnCount),
      restored: false,
    };
  }
  try {
    const raw = window.localStorage.getItem(key);
    return {
      cursor: clampAssistantCourseCursor(raw ? Number(raw) : 1, turnCount),
      restored: raw !== null,
    };
  } catch {
    return {
      cursor: clampAssistantCourseCursor(1, turnCount),
      restored: false,
    };
  }
}

export function AssistantSectionMaterial({
  userId,
  unitId,
  goalId,
  sectionId,
  sectionTitle,
  sectionNumber,
  contentRevision,
  material,
  blockOffset,
  complexComponentAnchors,
  materialCheckResults,
  onVerifiedAnswer,
  historical = false,
  forceExpanded = false,
  busy = false,
  containerRef,
  onFullyRevealedChange,
  onContinue,
  onMaterialChange,
  onMaterialCommitted,
  persistedCursor,
  onCursorChange,
  audioEligible = false,
  narrationAssets = [],
  onNarrationAsset,
  onRegenerateTopic,
  regeneratingTopicIndex,
  onActiveTopicChange,
}: {
  userId: string;
  unitId: string;
  goalId: string;
  sectionId: string;
  sectionTitle: string;
  sectionNumber: number;
  contentRevision: number;
  material: LearningMaterialContent;
  blockOffset: number;
  complexComponentAnchors: string[];
  materialCheckResults: MaterialCheckResult[];
  onVerifiedAnswer?: VerifiedMaterialAnswerHandler;
  historical?: boolean;
  forceExpanded?: boolean;
  busy?: boolean;
  containerRef?: Ref<HTMLElement>;
  onFullyRevealedChange?: (fullyRevealed: boolean) => void;
  onContinue?: () => void | Promise<void>;
  onMaterialChange?: (material: LearningMaterialContent) => void;
  onMaterialCommitted?: () => void | Promise<void>;
  persistedCursor?: number;
  onCursorChange?: (cursor: number) => void;
  audioEligible?: boolean;
  narrationAssets?: ChatNarrationAsset[];
  onNarrationAsset?: (asset: ChatNarrationAsset) => void;
  onRegenerateTopic?: (input: { topicId?: string; topicIndex: number }) => void;
  regeneratingTopicIndex?: number | null;
  onActiveTopicChange?: (
    identity: { topicId?: string; topicIndex: number } | null,
  ) => void;
}) {
  const t = useT();
  // Persisted legacy lessons may contain the render-time learner-name token.
  // Static course content and its TTS both use neutral second-person wording.
  const narrationMaterial = useMemo(
    () => personalizeLearnerContent(material),
    [material],
  );
  const turns = useMemo(
    () => buildAssistantCourseFeed(narrationMaterial),
    [narrationMaterial],
  );
  const beats = useMemo(() => buildAssistantCourseSceneBeats(turns), [turns]);
  const progressive = !historical && !forceExpanded;
  const storageKey = assistantCourseCursorStorageKey({
    userId,
    unitId,
    sectionId,
    contentRevision,
  });
  const handoffStorageKey = assistantCourseCursorHandoffStorageKey({
    userId,
    unitId,
    sectionId,
  });
  const [initialProgress] = useState(() => {
    if (typeof persistedCursor === "number") {
      return {
        cursor: clampAssistantCourseCursor(persistedCursor, turns.length),
        restored: true,
      };
    }
    const durable = readCursor(storageKey, turns.length);
    // The durable key changes once the server publishes the final material.
    // A component remount in that narrow window should resume the streamed
    // draft's cursor instead of presenting the committed material at turn 1.
    if (durable.restored) return durable;
    if (!canUseBrowserPersistentStorage()) {
      return {
        cursor: clampAssistantCourseCursor(1, turns.length),
        restored: false,
      };
    }
    try {
      const raw = window.localStorage.getItem(handoffStorageKey);
      return {
        cursor: resolveAssistantCourseCursorHandoff(raw, beats, turns.length),
        restored: raw !== null,
      };
    } catch {
      return {
        cursor: clampAssistantCourseCursor(1, turns.length),
        restored: false,
      };
    }
  });
  const initialCursor =
    historical || forceExpanded ? turns.length : initialProgress.cursor;
  const initialBeatIndex = assistantCourseBeatIndexForCursor(
    beats,
    initialCursor,
  );
  const initialTurn = turns[initialCursor - 1];
  const reduceMotionAtMount = prefersReducedMotion();
  const initiallyTypes =
    progressive &&
    !initialProgress.restored &&
    !reduceMotionAtMount &&
    initialTurn?.kind === "lesson" &&
    initialTurn.narration.length > 0;
  const stageOpening =
    progressive && !historical && !forceExpanded && !reduceMotionAtMount;
  const [activeBeatIndex, setActiveBeatIndex] = useState(initialBeatIndex);
  const [visibleTurnCount, setVisibleTurnCount] = useState(() => initialCursor);
  const [furthestSeenTurnCount, setFurthestSeenTurnCount] =
    useState(initialCursor);
  const visibleTurnCountRef = useRef(initialCursor);
  const lastReportedCursorRef = useRef(initialProgress.cursor);
  // Initialize presentation state only once. During first generation, each
  // material_partial replaces `material` and therefore `turns`; re-reading the
  // cursor after our persistence effect runs would misclassify that same mount
  // as restored progress and disable the opening typewriter animation.
  const [animateNewest, setAnimateNewest] = useState(initiallyTypes);
  const [typing, setTyping] = useState(initiallyTypes);
  const [preparingTurnIndex, setPreparingTurnIndex] = useState<number | null>(
    null,
  );
  const [reservedTurnMinHeight, setReservedTurnMinHeight] = useState<
    number | null
  >(null);
  const [advancing, setAdvancing] = useState(false);
  const learningView = useLearningViewSettings();
  const runtimeAudioEligible = audioEligible && supportsChatAudioGeneration();
  const audioEnabled =
    runtimeAudioEligible && Boolean(learningView.data?.chatAudioEnabled);
  const [audioAutoPlay, setAudioAutoPlay] = useState(true);
  const previousAudioEnabledRef = useRef(audioEnabled);
  const [loadedNarrationAssets, setLoadedNarrationAssets] = useState<
    ChatNarrationAsset[]
  >([]);
  const [revealedLength, setRevealedLength] = useState<number | undefined>();
  const [activeAudioContentKey, setActiveAudioContentKey] = useState<
    string | null
  >(null);
  const [audioFallback, setAudioFallback] = useState(false);
  const [audioPlayingContentKey, setAudioPlayingContentKey] = useState<
    string | null
  >(null);
  const [audioLoadingContentKey, setAudioLoadingContentKey] = useState<
    string | null
  >(null);
  const [audioPreparing, setAudioPreparing] = useState(false);
  const [requestedScrollTurnIndex, setRequestedScrollTurnIndex] = useState<
    number | null
  >(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const audioFrameRef = useRef<number | null>(null);
  const playbackAttemptRef = useRef(0);
  const activeAudioTextRef = useRef("");
  const musicPlayerRef = useRef<MusicClipPlayer | null>(null);
  const [readingMusic, setReadingMusic] = useState<MusicPlaybackState>();
  const [musicError, setMusicError] = useState("");
  const musicPlansRef = useRef(new Map<string, TimelineMusicInput>());
  musicPlansRef.current = useMemo(() => {
    const plans = new Map<string, TimelineMusicInput>();
    let display: unknown;
    narrationMaterial.blocks.forEach((block, index) => {
      if (block.type === "heading") display = undefined;
      else if (block.type === "paragraph") {
        const action = (block as { cue?: { music?: unknown } }).cue?.music;
        if (action) {
          const plan = resolveMusicCue(display, action);
          if (plan) plans.set(`block:${index}`, plan);
        }
      } else if (block.type !== "check") display = block;
    });
    return plans;
  }, [narrationMaterial]);
  const playbackKeyRef = useRef("");
  const ensureKeyRef = useRef("");
  const onNarrationAssetRef = useRef(onNarrationAsset);
  const shouldScrollPreparedTurnRef = useRef(true);
  const learnerInterruptedRef = useRef(false);
  const sceneContentRef = useRef<HTMLDivElement>(null);
  const allNarrationAssets = useMemo(() => {
    const byKey = new Map<string, ChatNarrationAsset>();
    [...loadedNarrationAssets, ...narrationAssets].forEach((asset) => {
      byKey.set(asset.contentKey, asset);
    });
    return byKey;
  }, [loadedNarrationAssets, narrationAssets]);
  const expectedNarration = useMemo(() => {
    const entries = new Map<string, string>();
    const introduction = narrationMaterial.introduction.trim();
    if (introduction) entries.set("intro", introduction);
    narrationMaterial.blocks.forEach((block, index) => {
      if (block.type === "paragraph" && block.text.trim()) {
        entries.set(`block:${index}`, block.text.trim());
      }
    });
    return entries;
  }, [narrationMaterial]);
  const activeBeat =
    beats[Math.min(activeBeatIndex, Math.max(0, beats.length - 1))];
  const currentTopicIdentity = useMemo(() => {
    const blockIndex = sceneTopicBlockIndex(turns, activeBeat);
    return blockIndex == null
      ? null
      : headingTopicIdentity(material.blocks, blockIndex);
  }, [activeBeat, material.blocks, turns]);
  useEffect(() => {
    onActiveTopicChange?.(currentTopicIdentity);
  }, [currentTopicIdentity, onActiveTopicChange]);
  const nextBeat = beats[activeBeatIndex + 1];
  const presentedTurnCount = clampAssistantCourseCursor(
    visibleTurnCount,
    turns.length,
  );
  const currentTurn = turns[presentedTurnCount - 1];
  const currentNarration =
    currentTurn?.kind === "lesson" ? currentTurn.narration[0] : undefined;
  const currentContentKey = currentNarration
    ? currentNarration.kind === "introduction"
      ? "intro"
      : `block:${currentNarration.blockIndex}`
    : undefined;
  const currentNarrationText = currentNarration?.text ?? "";
  onNarrationAssetRef.current = onNarrationAsset;
  const candidateAudioAsset = currentContentKey
    ? allNarrationAssets.get(currentContentKey)
    : undefined;
  const currentAudioAsset =
    candidateAudioAsset &&
    chatNarrationAssetMatchesText(candidateAudioAsset, currentNarrationText)
      ? candidateAudioAsset
      : undefined;

  const stopAudio = useCallback((revealAll = false) => {
    releaseMusicAudio(audioRef);
    playbackAttemptRef.current += 1;
    musicPlayerRef.current?.stop();
    setReadingMusic(undefined);
    if (audioFrameRef.current !== null) {
      window.cancelAnimationFrame(audioFrameRef.current);
      audioFrameRef.current = null;
    }
    audioRef.current?.pause();
    setAudioPlayingContentKey(null);
    if (revealAll && activeAudioTextRef.current) {
      setRevealedLength(activeAudioTextRef.current.length);
    }
  }, []);

  const playAsset = useCallback(
    async (
      asset: ChatNarrationAsset,
      narrationText: string,
      restart = false,
      synchronizeText = false,
    ) => {
      const attempt = ++playbackAttemptRef.current;
      claimMusicAudio(audioRef, () => stopAudio());
      musicPlayerRef.current?.stop();
      setReadingMusic(undefined);
      setMusicError("");
      const musicPlan = musicPlansRef.current.get(asset.contentKey);
      if (audioFrameRef.current !== null) {
        window.cancelAnimationFrame(audioFrameRef.current);
        audioFrameRef.current = null;
      }
      audioRef.current?.pause();
      activeAudioTextRef.current = narrationText;
      if (synchronizeText) {
        setActiveAudioContentKey(asset.contentKey);
        setRevealedLength(0);
        setAudioFallback(false);
      }
      setAudioLoadingContentKey(asset.contentKey);
      setAudioPlayingContentKey(null);
      try {
        if (musicPlan) {
          musicPlayerRef.current ??= new MusicClipPlayer();
          await musicPlayerRef.current.prepare(musicPlan);
          if (attempt !== playbackAttemptRef.current) return;
        }
        let audio = audioRef.current;
        if (
          !audio ||
          audio.dataset.audioId !== asset.audioId ||
          !audioObjectUrlRef.current
        ) {
          audio?.pause();
          if (audioObjectUrlRef.current) {
            URL.revokeObjectURL(audioObjectUrlRef.current);
          }
          const response = await apiFetch(asset.audioUrl);
          if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
          const objectUrl = URL.createObjectURL(await response.blob());
          audioObjectUrlRef.current = objectUrl;
          audio = new Audio(objectUrl);
          audio.dataset.audioId = asset.audioId;
          audioRef.current = audio;
        }
        if (attempt !== playbackAttemptRef.current) return;
        if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
          await new Promise<void>((resolve, reject) => {
            audio!.onloadedmetadata = () => resolve();
            audio!.onerror = () => reject(new Error("Audio metadata failed"));
          });
        }
        if (attempt !== playbackAttemptRef.current) return;
        const playbackTiming = resolveChatNarrationPlaybackTiming(
          asset,
          audio.duration * 1000,
        );
        const audioStartSeconds = playbackTiming.audioStartMs / 1000;
        const audioEndSeconds = playbackTiming.audioEndMs / 1000;
        if (
          restart ||
          audio.currentTime < audioStartSeconds ||
          audio.currentTime >= audioEndSeconds
        ) {
          audio.currentTime = audioStartSeconds;
        }
        let segmentFinished = false;
        const finishSegment = () => {
          if (attempt !== playbackAttemptRef.current) return;
          if (segmentFinished) return;
          segmentFinished = true;
          releaseMusicAudio(audioRef);
          audio.pause();
          if (audioFrameRef.current !== null) {
            window.cancelAnimationFrame(audioFrameRef.current);
            audioFrameRef.current = null;
          }
          setRevealedLength(narrationText.length);
          if (musicPlan && musicPlayerRef.current) {
            void musicPlayerRef.current
              .play(musicPlan, 0, (tick) => {
                if (attempt !== playbackAttemptRef.current) return;
                if (tick == null) {
                  setReadingMusic(undefined);
                  setAudioPlayingContentKey(null);
                  return;
                }
                const notes = musicPlan.notes.filter(
                  (n) =>
                    tick >= n.startTick && tick < n.startTick + n.durationTicks,
                );
                setReadingMusic({
                  figureId: musicPlan.figureId,
                  clipId: musicPlan.clipId,
                  label: musicPlan.label,
                  elapsedTicks: tick,
                  targetIds: notes.map((n) => n.targetId),
                  midi: notes.map((n) => n.midi),
                });
              })
              .catch((error) => {
                if (attempt === playbackAttemptRef.current) {
                  setMusicError(String(error));
                  setReadingMusic(undefined);
                  setAudioPlayingContentKey(null);
                }
              });
          } else setAudioPlayingContentKey(null);
        };
        const sync = () => {
          if (attempt !== playbackAttemptRef.current) {
            audioFrameRef.current = null;
            return;
          }
          if (!audioRef.current || audioRef.current.paused) {
            audioFrameRef.current = null;
            return;
          }
          const nowMs = audioRef.current.currentTime * 1000;
          if (nowMs >= playbackTiming.audioEndMs) {
            finishSegment();
            return;
          }
          let nextOffset = 0;
          for (const timing of playbackTiming.chars) {
            if (timing.startMs > nowMs) break;
            nextOffset = timing.endOffset;
          }
          setRevealedLength(nextOffset);
          audioFrameRef.current = window.requestAnimationFrame(sync);
        };
        audio.ontimeupdate = () => {
          if (audio.currentTime >= audioEndSeconds) finishSegment();
        };
        audio.onended = finishSegment;
        await audio.play();
        if (attempt !== playbackAttemptRef.current) {
          audio.pause();
          return;
        }
        setAudioPlayingContentKey(asset.contentKey);
        audioFrameRef.current = window.requestAnimationFrame(sync);
      } catch (error) {
        if (attempt === playbackAttemptRef.current) {
          if (musicPlan) setMusicError(String(error));
          setAudioFallback(true);
          setRevealedLength(undefined);
          setAudioPlayingContentKey(null);
        }
      } finally {
        if (attempt === playbackAttemptRef.current) {
          setAudioLoadingContentKey(null);
        }
      }
    },
    [stopAudio],
  );

  useEffect(() => {
    if (audioEnabled && !previousAudioEnabledRef.current) {
      setAudioAutoPlay(true);
    }
    previousAudioEnabledRef.current = audioEnabled;
  }, [audioEnabled]);

  useEffect(() => {
    const hide = () => {
      if (document.hidden) stopAudio();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [stopAudio]);

  useEffect(() => {
    if (!audioEnabled) {
      ensureKeyRef.current = "";
      setAudioPreparing(false);
      return;
    }
    if (busy) return;
    const ensureKey = `${sectionId}:${contentRevision}`;
    if (ensureKeyRef.current === ensureKey) return;
    ensureKeyRef.current = ensureKey;
    let cancelled = false;
    const controller = new AbortController();
    setAudioPreparing(true);
    const acceptAssets = (assets: ChatNarrationAsset[]) => {
      if (cancelled || assets.length === 0) return;
      setLoadedNarrationAssets((current) => {
        const next = new Map(current.map((asset) => [asset.contentKey, asset]));
        assets.forEach((asset) => next.set(asset.contentKey, asset));
        return [...next.values()];
      });
      assets.forEach((asset) => onNarrationAssetRef.current?.(asset));
    };
    const loadCatalog = async () => {
      const query = new URLSearchParams({ sectionId });
      const response = await apiFetch(
        `/api/units/${unitId}/chat-audio?${query.toString()}`,
        { signal: controller.signal },
      );
      if (!response.ok) return [];
      const payload = (await response.json()) as {
        assets?: ChatNarrationAsset[];
      };
      const assets = payload.assets ?? [];
      acceptAssets(assets);
      return assets;
    };
    const catalogIsComplete = (assets: ChatNarrationAsset[]) => {
      const byKey = new Map(assets.map((asset) => [asset.contentKey, asset]));
      return [...expectedNarration].every(([contentKey, text]) => {
        const asset = byKey.get(contentKey);
        return Boolean(asset && chatNarrationAssetMatchesText(asset, text));
      });
    };
    void (async () => {
      const cached = await loadCatalog().catch(() => []);
      if (cancelled || catalogIsComplete(cached)) return;
      const ensureResponse = await apiFetch(
        `/api/units/${unitId}/chat-audio/ensure`,
        {
          method: "POST",
          body: JSON.stringify({ sectionId }),
          signal: controller.signal,
        },
      );
      if (!ensureResponse.ok) {
        throw new Error(`Audio ensure HTTP ${ensureResponse.status}`);
      }

      // Synthesis is durable background work. Poll the catalog so navigation
      // and transient browser connections never own the provider lifecycle.
      for (let attempt = 0; attempt < 120 && !cancelled; attempt += 1) {
        const assets = await loadCatalog().catch(() => []);
        if (catalogIsComplete(assets)) return;
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 1_500);
        });
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setAudioPreparing(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (ensureKeyRef.current === ensureKey) {
        ensureKeyRef.current = "";
      }
    };
  }, [
    audioEnabled,
    busy,
    contentRevision,
    expectedNarration,
    sectionId,
    unitId,
  ]);

  useEffect(() => {
    if (!audioEnabled || audioAutoPlay) return;
    stopAudio(true);
  }, [audioAutoPlay, audioEnabled, stopAudio]);

  useEffect(() => {
    stopAudio();
    playbackKeyRef.current = "";
    setAudioFallback(false);
    setActiveAudioContentKey(currentContentKey ?? null);
    setRevealedLength(
      audioEnabled && audioAutoPlay && currentContentKey ? 0 : undefined,
    );
  }, [audioAutoPlay, audioEnabled, currentContentKey, stopAudio]);

  useEffect(() => {
    if (
      !audioEnabled ||
      !audioAutoPlay ||
      !currentAudioAsset ||
      !currentContentKey ||
      historical
    ) {
      return;
    }
    const key = `${presentedTurnCount - 1}:${currentAudioAsset.audioId}`;
    if (playbackKeyRef.current === key) return;
    playbackKeyRef.current = key;
    // TTS commonly becomes ready after the visual typewriter has completed.
    // Autoplay from asset readiness, not from the shorter-lived typing state.
    // If text already fell back to a complete render, keep it visible while
    // narration starts instead of making the paragraph disappear again.
    void playAsset(
      currentAudioAsset,
      currentNarrationText,
      true,
      typing && !audioFallback,
    );
  }, [
    audioEnabled,
    audioAutoPlay,
    audioFallback,
    currentAudioAsset,
    currentContentKey,
    currentNarrationText,
    historical,
    playAsset,
    presentedTurnCount,
    typing,
  ]);

  const toggleAudioAutoPlay = useCallback(() => {
    if (audioAutoPlay) {
      setAudioAutoPlay(false);
      stopAudio(true);
      setTyping(false);
      setAnimateNewest(false);
      return;
    }

    setAudioAutoPlay(true);
    if (currentAudioAsset && currentNarrationText) {
      void playAsset(
        currentAudioAsset,
        currentNarrationText,
        false,
        typing && !audioFallback,
      );
    }
  }, [
    audioAutoPlay,
    audioFallback,
    currentAudioAsset,
    currentNarrationText,
    playAsset,
    stopAudio,
    typing,
  ]);

  const renderNarrationAudioControl = useCallback(
    (contentKey: string, narrationText: string) => {
      const candidate = allNarrationAssets.get(contentKey);
      const asset =
        candidate && chatNarrationAssetMatchesText(candidate, narrationText)
          ? candidate
          : undefined;
      const playing = audioPlayingContentKey === contentKey;
      const loading = audioLoadingContentKey === contentKey;
      const preparing = audioPreparing && !asset;
      return (
        <div className="mt-1 flex justify-end gap-0.5">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="size-7"
            disabled={!asset || loading}
            title={preparing ? t("wizard.section.audioPreparing") : undefined}
            onClick={() => {
              if (!asset) return;
              if (playing) {
                stopAudio();
              } else {
                void playAsset(asset, narrationText);
              }
            }}
            aria-label={
              playing
                ? t("wizard.section.pauseAudio")
                : t("wizard.section.playAudio")
            }
          >
            {preparing || loading ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : playing ? (
              <Pause aria-hidden />
            ) : (
              <Play aria-hidden />
            )}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="size-7"
            disabled={!asset || loading}
            onClick={() => {
              if (asset) void playAsset(asset, narrationText, true);
            }}
            aria-label={t("wizard.section.replayAudio")}
          >
            <RotateCcw aria-hidden />
          </Button>
        </div>
      );
    },
    [
      allNarrationAssets,
      audioLoadingContentKey,
      audioPlayingContentKey,
      audioPreparing,
      playAsset,
      stopAudio,
      t,
    ],
  );

  useEffect(() => {
    if (
      !typing ||
      !audioEnabled ||
      audioFallback ||
      currentAudioAsset ||
      busy
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setAudioFallback(true);
      setRevealedLength(undefined);
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [audioEnabled, audioFallback, busy, currentAudioAsset, typing]);

  useEffect(
    () => () => {
      if (audioFrameRef.current !== null) {
        window.cancelAnimationFrame(audioFrameRef.current);
      }
      audioRef.current?.pause();
      playbackAttemptRef.current++;
      releaseMusicAudio(audioRef);
      musicPlayerRef.current?.dispose();
      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
      }
    },
    [],
  );

  visibleTurnCountRef.current = visibleTurnCount;

  useEffect(() => {
    if (historical || furthestSeenTurnCount <= 0 || turns.length <= 0) return;
    const nextDurable = Math.max(initialProgress.cursor, furthestSeenTurnCount);
    if (canUseBrowserPersistentStorage()) {
      try {
        const stored = readCursor(storageKey, Number.MAX_SAFE_INTEGER).cursor;
        const persisted = Math.max(stored, nextDurable);
        window.localStorage.setItem(storageKey, String(persisted));
        if (busy) {
          window.localStorage.setItem(
            handoffStorageKey,
            createAssistantCourseCursorHandoff(
              beats,
              activeBeatIndex,
              persisted,
            ),
          );
        } else {
          // A stable revision now owns progress. Do not let a completed lesson's
          // cursor leak into an intentional later regeneration.
          window.localStorage.removeItem(handoffStorageKey);
        }
      } catch {
        // Browser persistence is best-effort; the session cursor still wins.
      }
    }
    if (lastReportedCursorRef.current !== nextDurable) {
      lastReportedCursorRef.current = nextDurable;
      onCursorChange?.(nextDurable);
    }
  }, [
    activeBeatIndex,
    beats,
    busy,
    furthestSeenTurnCount,
    handoffStorageKey,
    historical,
    initialProgress.cursor,
    onCursorChange,
    storageKey,
    turns.length,
  ]);

  useLayoutEffect(() => {
    // The committed material can normalize, insert headings, or omit draft
    // turns. Keep the learner's cursor; only the on-screen slice is clamped.
    const cursor = visibleTurnCountRef.current;
    setActiveBeatIndex((current) => {
      const currentBeat = beats[current];
      if (
        currentBeat &&
        cursor > currentBeat.startTurnIndex &&
        cursor <= currentBeat.endTurnIndex
      ) {
        return current;
      }
      const next = assistantCourseBeatIndexForCursor(beats, cursor);
      return next === current ? current : next;
    });
    setPreparingTurnIndex((current) =>
      current !== null && current >= turns.length ? null : current,
    );
  }, [beats, turns.length]);

  const fullyRevealed =
    Boolean(activeBeat) &&
    activeBeatIndex >= beats.length - 1 &&
    preparingTurnIndex === null &&
    presentedTurnCount >= activeBeat.endTurnIndex;
  const hasJitBuffer = hasAssistantCourseJitBuffer(
    presentedTurnCount,
    turns.length,
  );
  const waitingForContent = busy && !typing && !hasJitBuffer;
  const continueDisabled =
    advancing ||
    animateNewest ||
    preparingTurnIndex !== null ||
    typing ||
    waitingForContent ||
    (turns.length === 0 && !onContinue);
  useEffect(() => {
    onFullyRevealedChange?.(fullyRevealed);
  }, [fullyRevealed, onFullyRevealedChange]);

  const handleMaterialCommitted = useCallback(async () => {
    // A material refresh reloads and briefly unmounts this section. Record the
    // presented part immediately before that reload so the new revision opens
    // here instead of falling back to part one.
    try {
      if (!canUseBrowserPersistentStorage()) {
        await onMaterialCommitted?.();
        return;
      }
      window.localStorage.setItem(
        handoffStorageKey,
        createAssistantCourseCursorHandoff(
          beats,
          activeBeatIndex,
          visibleTurnCount,
        ),
      );
    } catch {
      // Presentation handoff is best-effort.
    }
    await onMaterialCommitted?.();
  }, [
    activeBeatIndex,
    beats,
    handoffStorageKey,
    onMaterialCommitted,
    visibleTurnCount,
  ]);

  useEffect(() => {
    if (!progressive) return;
    const interruptAutoScroll = () => {
      learnerInterruptedRef.current = true;
    };
    const interruptOnScrollKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches(
          "input, textarea, select, [contenteditable='true'], [role='textbox']",
        )
      ) {
        return;
      }
      if (
        [
          "ArrowDown",
          "ArrowUp",
          "End",
          "Home",
          "PageDown",
          "PageUp",
          " ",
        ].includes(event.key)
      ) {
        interruptAutoScroll();
      }
    };
    window.addEventListener("wheel", interruptAutoScroll, { passive: true });
    window.addEventListener("touchmove", interruptAutoScroll, {
      passive: true,
    });
    window.addEventListener("keydown", interruptOnScrollKey);
    return () => {
      window.removeEventListener("wheel", interruptAutoScroll);
      window.removeEventListener("touchmove", interruptAutoScroll);
      window.removeEventListener("keydown", interruptOnScrollKey);
    };
  }, [progressive]);

  useLayoutEffect(() => {
    if (!progressive || preparingTurnIndex === null) return;

    const turn = document.querySelector<HTMLElement>(
      `[data-assistant-section="${sectionId}"] [data-assistant-turn-index="${preparingTurnIndex}"]`,
    );
    const newestTurn = turns[preparingTurnIndex];
    const reduceMotion = prefersReducedMotion();
    let cancelled = false;
    let revealFrame: number | null = null;

    const reveal = () => {
      if (cancelled) return;
      setPreparingTurnIndex(null);
      setAnimateNewest(!reduceMotion && Boolean(newestTurn));
      setTyping(
        !reduceMotion &&
          newestTurn?.kind === "lesson" &&
          newestTurn.narration.length > 0,
      );
      if (reduceMotion || !newestTurn) {
        setReservedTurnMinHeight(null);
      }
    };

    if (!turn) {
      reveal();
      return;
    }

    // Mount the complete turn invisibly for one layout pass. Its measured
    // height prevents the typewriter from changing document geometry, without
    // adding viewport-sized blank space on small screens.
    const measuredTurnHeight = Math.ceil(turn.getBoundingClientRect().height);
    setReservedTurnMinHeight(measuredTurnHeight);
    // Only an explicit learner Continue requests a scroll. Initial/JIT reveals
    // stay put, while Continue pins the newly appeared block to the bottom.
    const shouldScroll =
      shouldScrollPreparedTurnRef.current && !learnerInterruptedRef.current;

    revealFrame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      reveal();
      if (!shouldScroll) return;
      const root = resolveAssistantCourseScrollRoot(turn);
      const geometry = measureAssistantCourseScrollGeometry(root, turn);
      const targetScrollY = resolveAssistantCourseContinueScrollTop({
        ...geometry,
        bottomInset: COURSE_SCROLL_BOTTOM_INSET,
      });
      const currentY = currentAssistantCourseScrollY(root);
      if (targetScrollY > currentY + 1) {
        scrollAssistantCourseRoot(
          root,
          targetScrollY,
          reduceMotion ? "auto" : "smooth",
        );
      }
    });

    return () => {
      cancelled = true;
      if (revealFrame !== null) window.cancelAnimationFrame(revealFrame);
    };
  }, [preparingTurnIndex, progressive, sectionId, turns]);

  useLayoutEffect(() => {
    if (requestedScrollTurnIndex === null) return;

    const turn = document.querySelector<HTMLElement>(
      `[data-assistant-section="${sectionId}"] [data-assistant-turn-index="${requestedScrollTurnIndex}"]`,
    );
    setRequestedScrollTurnIndex(null);
    if (!turn) return;

    if (learnerInterruptedRef.current) return;

    const root = resolveAssistantCourseScrollRoot(turn);
    const geometry = measureAssistantCourseScrollGeometry(root, turn);
    const targetScrollY = resolveAssistantCourseContinueScrollTop({
      ...geometry,
      bottomInset: COURSE_SCROLL_BOTTOM_INSET,
    });
    const currentY = currentAssistantCourseScrollY(root);
    if (targetScrollY <= currentY + 1) return;

    scrollAssistantCourseRoot(
      root,
      targetScrollY,
      prefersReducedMotion() ? "auto" : "smooth",
    );
  }, [requestedScrollTurnIndex, sectionId]);

  const prepareTurn = useCallback(
    (turnIndex: number, scrollToTurn: boolean) => {
      if (preparingTurnIndex !== null || turnIndex >= turns.length) return;
      setAnimateNewest(false);
      setTyping(false);
      setReservedTurnMinHeight(null);
      shouldScrollPreparedTurnRef.current = scrollToTurn;
      // Expose the complete next turn invisibly first. The layout effect
      // measures it and reserves its final height before starting the reveal.
      setPreparingTurnIndex(turnIndex);
      setVisibleTurnCount(
        clampAssistantCourseCursor(turnIndex + 1, turns.length),
      );
      setFurthestSeenTurnCount((current) =>
        monotonicAssistantCourseCursor(current, turnIndex + 1, turns.length),
      );
    },
    [preparingTurnIndex, turns.length],
  );

  useEffect(() => {
    if (
      !progressive ||
      visibleTurnCount > 0 ||
      turns.length === 0 ||
      preparingTurnIndex !== null
    ) {
      return;
    }

    // A JIT section can mount from an empty material_partial before its first
    // playable block arrives. Start that first turn as soon as it exists,
    // matching the behavior of a section whose content was ready at mount.
    prepareTurn(0, false);
  }, [
    prepareTurn,
    preparingTurnIndex,
    progressive,
    turns.length,
    visibleTurnCount,
  ]);

  useEffect(() => {
    if (
      !progressive ||
      !activeBeat ||
      animateNewest ||
      typing ||
      preparingTurnIndex !== null
    )
      return;
    const next = assistantCourseFirstExplanationIndex(
      turns,
      presentedTurnCount,
      activeBeat.endTurnIndex,
    );
    if (next != null) prepareTurn(next, false);
  }, [
    progressive,
    activeBeat,
    animateNewest,
    typing,
    preparingTurnIndex,
    turns,
    presentedTurnCount,
    prepareTurn,
  ]);

  const openBeat = useCallback(
    (
      nextBeatIndex: number,
      animateContent: boolean,
      _direction: "forward" | "backward",
      _replay = false,
      scrollToTurn = false,
    ) => {
      const nextBeat = beats[nextBeatIndex];
      if (!nextBeat) return;
      stopAudio();
      setPreparingTurnIndex(null);
      setReservedTurnMinHeight(null);
      setActiveBeatIndex(nextBeatIndex);
      if (scrollToTurn) {
        setRequestedScrollTurnIndex(nextBeat.startTurnIndex);
      }

      const alreadySeen =
        historical || furthestSeenTurnCount > nextBeat.startTurnIndex;
      const reduceMotion = prefersReducedMotion();
      if (alreadySeen || !animateContent) {
        setVisibleTurnCount(
          historical
            ? nextBeat.endTurnIndex
            : Math.min(furthestSeenTurnCount, nextBeat.endTurnIndex),
        );
        setAnimateNewest(false);
        setTyping(false);
        return;
      }

      const firstVisible = nextBeat.startTurnIndex + 1;
      const firstTurn = turns[nextBeat.startTurnIndex];
      setVisibleTurnCount(firstVisible);
      setFurthestSeenTurnCount((current) =>
        monotonicAssistantCourseCursor(current, firstVisible, turns.length),
      );
      setAnimateNewest(!reduceMotion);
      setTyping(
        !reduceMotion &&
          firstTurn?.kind === "lesson" &&
          firstTurn.narration.length > 0,
      );
    },
    [beats, furthestSeenTurnCount, historical, stopAudio, turns],
  );

  const handleBack = useCallback(() => {
    if (presentedTurnCount <= 1) return;
    stopAudio();
    learnerInterruptedRef.current = true;
    setPreparingTurnIndex(null);
    setReservedTurnMinHeight(null);
    setAnimateNewest(false);
    setTyping(false);
    const previousBeatIndex = Math.max(0, activeBeatIndex - 1);
    setActiveBeatIndex(previousBeatIndex);
    setVisibleTurnCount(
      Math.min(
        furthestSeenTurnCount,
        beats[previousBeatIndex]?.endTurnIndex ?? 1,
      ),
    );
  }, [
    presentedTurnCount,
    activeBeatIndex,
    furthestSeenTurnCount,
    beats,
    stopAudio,
  ]);

  const handleContinue = useCallback(async () => {
    if (preparingTurnIndex !== null || typing || animateNewest) return;
    if (activeBeat && presentedTurnCount < activeBeat.endTurnIndex) {
      if (busy && !hasJitBuffer) return;
      learnerInterruptedRef.current = false;
      prepareTurn(presentedTurnCount, true);
      return;
    }
    if (activeBeatIndex < beats.length - 1) {
      learnerInterruptedRef.current = false;
      openBeat(activeBeatIndex + 1, true, "forward", true, true);
      return;
    }
    if (!onContinue || advancing || busy) return;
    setAdvancing(true);
    try {
      await onContinue();
    } finally {
      setAdvancing(false);
    }
  }, [
    advancing,
    activeBeatIndex,
    activeBeat,
    animateNewest,
    beats.length,
    busy,
    hasJitBuffer,
    onContinue,
    openBeat,
    prepareTurn,
    presentedTurnCount,
    preparingTurnIndex,
    typing,
  ]);

  const revealCurrentText = useCallback(() => {
    if (!typing) return;
    learnerInterruptedRef.current = false;
    stopAudio(true);
    setTyping(false);
    setAnimateNewest(false);
  }, [stopAudio, typing]);

  const handleStageAdvance = useCallback(() => {
    if (typing) {
      revealCurrentText();
      return;
    }
    if (
      !activeBeat ||
      presentedTurnCount >= activeBeat.endTurnIndex ||
      continueDisabled
    ) {
      return;
    }
    void handleContinue();
  }, [
    activeBeat,
    continueDisabled,
    handleContinue,
    presentedTurnCount,
    revealCurrentText,
    typing,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          "button, a, input, textarea, select, [role='button'], [contenteditable='true']",
        )
      ) {
        return;
      }
      if (event.key === "ArrowLeft" && presentedTurnCount > 1) {
        event.preventDefault();
        handleBack();
      } else if (event.key === "ArrowRight" && !continueDisabled) {
        event.preventDefault();
        void handleContinue();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [presentedTurnCount, continueDisabled, handleBack, handleContinue]);

  const sceneControls = (
    <div
      data-learning-scene-controls
      className="course-conversation-navigation"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(8.5rem,1.15fr)] items-center gap-x-2 gap-y-3 sm:flex sm:gap-3">
        {turns.length > 1 ? (
          <Button
            type="button"
            variant="ghost"
            className="course-scene-back order-2 w-full min-w-0 text-muted-foreground hover:text-foreground sm:order-none sm:w-auto sm:min-w-24 sm:shrink-0"
            disabled={presentedTurnCount <= 1 || advancing}
            onClick={handleBack}
          >
            <ChevronLeft aria-hidden />
            {t("learningScene.back")}
          </Button>
        ) : (
          <span className="hidden min-w-24 sm:block" aria-hidden />
        )}
        <div
          className="course-scene-progress order-1 col-span-2 flex min-w-0 flex-col items-center justify-center gap-1.5 sm:order-none sm:flex-1"
          aria-label={t("learningScene.beatProgress", {
            current: activeBeatIndex + 1,
            total: Math.max(1, beats.length),
          })}
        >
          {beats.length > 1 ? (
            <>
              <span className="text-[0.6875rem] font-medium tabular-nums text-[var(--course-content-muted)] sm:text-xs">
                {t("learningScene.beatProgress", {
                  current: activeBeatIndex + 1,
                  total: Math.max(1, beats.length),
                })}
              </span>
              <div className="flex max-w-full items-center justify-start gap-1.5 overflow-x-auto px-1 py-0.5 sm:justify-center">
                {beats.map((beat, index) => {
                  const seen = furthestSeenTurnCount >= beat.endTurnIndex;
                  const available = index <= activeBeatIndex || seen;
                  return (
                    <button
                      key={beat.key}
                      type="button"
                      disabled={!available || advancing}
                      aria-current={
                        index === activeBeatIndex ? "step" : undefined
                      }
                      aria-label={t("learningScene.openBeat", {
                        current: index + 1,
                        total: beats.length,
                      })}
                      data-step-state={
                        index === activeBeatIndex
                          ? "active"
                          : seen
                            ? "seen"
                            : "upcoming"
                      }
                      className={cn(
                        "course-scene-step h-1.5 shrink-0 rounded-full transition-all motion-reduce:transition-none",
                        index === activeBeatIndex
                          ? "w-7 bg-primary"
                          : seen
                            ? "w-3 bg-[var(--success-500)]"
                            : "w-3 bg-[var(--course-content-border)]",
                      )}
                      onClick={() =>
                        available &&
                        openBeat(
                          index,
                          true,
                          index > activeBeatIndex ? "forward" : "backward",
                          true,
                        )
                      }
                    />
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
        <div
          className={cn(
            "course-scene-primary order-3 flex min-w-0 items-center justify-end gap-2 sm:order-none",
            beats.length <= 1 && "col-span-2",
          )}
        >
          {audioEnabled ? (
            <Button
              type="button"
              size="icon-lg"
              variant="outline"
              className="size-11 shrink-0 rounded-xl bg-background/90"
              aria-pressed={audioAutoPlay}
              aria-label={
                audioAutoPlay
                  ? t("wizard.section.pauseAutoAudio")
                  : t("wizard.section.playAutoAudio")
              }
              title={
                audioAutoPlay
                  ? t("wizard.section.pauseAutoAudio")
                  : t("wizard.section.playAutoAudio")
              }
              onClick={toggleAudioAutoPlay}
            >
              {audioAutoPlay ? <Pause aria-hidden /> : <Play aria-hidden />}
            </Button>
          ) : null}
          <Button
            type="button"
            size="lg"
            className="h-auto min-h-11 w-full min-w-0 justify-between rounded-xl px-3 py-2 text-left shadow-none hover:brightness-[1.03] sm:w-auto sm:min-w-[11.5rem] sm:shrink-0 sm:px-3.5"
            disabled={continueDisabled && !typing}
            onClick={() => {
              if (typing) {
                revealCurrentText();
                return;
              }
              void handleContinue();
            }}
          >
            {activeBeat && presentedTurnCount < activeBeat.endTurnIndex ? (
              t("learningConversation.continue")
            ) : activeBeatIndex < beats.length - 1 ? (
              <span className="flex min-w-0 flex-col items-end text-right leading-tight">
                <span>{t("learningScene.nextPart")}</span>
                {nextBeat?.title ? (
                  <span className="mt-1 hidden max-w-44 truncate text-xs font-normal opacity-85 sm:block sm:max-w-60">
                    {nextBeat.title}
                  </span>
                ) : null}
              </span>
            ) : historical ? (
              t("learningScene.returnCurrent")
            ) : (
              t("learningScene.completeSection")
            )}
            <span className="ml-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-white/15">
              <ChevronRight aria-hidden className="size-4" />
            </span>
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <MusicTimelineContext.Provider
      value={{ clocked: false, music: readingMusic }}
    >
      <section
        ref={containerRef}
        data-assistant-section={sectionId}
        data-integrated-course-controls="true"
        className={cn(
          "mx-auto w-full max-w-[90rem] scroll-mt-24 px-0.5 sm:px-0",
          historical && "opacity-95",
        )}
      >
        <div
          data-learning-scene-stage
          className="relative min-h-[16rem] px-2 py-3 sm:min-h-[19rem] sm:px-3 sm:py-4"
          onClickCapture={(event) => {
            const target = event.target;
            if (isLearningSceneControlTarget(target)) {
              return;
            }
            if (window.getSelection()?.toString().trim()) return;
            handleStageAdvance();
          }}
        >
          <div ref={sceneContentRef} className="relative z-[1]">
            <AnchoredLearningMaterial
              unitId={unitId}
              goalId={goalId}
              material={material}
              sectionId={sectionId}
              onMaterialChange={onMaterialChange}
              onMaterialCommitted={handleMaterialCommitted}
              continuous
              blockOffset={blockOffset}
              complexComponentAnchors={complexComponentAnchors}
              onVerifiedAnswer={onVerifiedAnswer}
              materialCheckResults={materialCheckResults}
              onRegenerateTopic={onRegenerateTopic}
              regeneratingTopicIndex={regeneratingTopicIndex}
              assistantFeed={{
                controls: sceneControls,
                firstVisibleTurnIndex: activeBeat?.startTurnIndex ?? 0,
                visibleTurnCount: presentedTurnCount,
                stagedOpeningTurnIndex:
                  stageOpening &&
                  animateNewest &&
                  presentedTurnCount === (activeBeat?.startTurnIndex ?? 0) + 1
                    ? activeBeat?.startTurnIndex
                    : undefined,
                preparingTurnIndex:
                  progressive && preparingTurnIndex !== null
                    ? preparingTurnIndex
                    : undefined,
                reservedTurnMinHeight:
                  progressive && reservedTurnMinHeight !== null
                    ? reservedTurnMinHeight
                    : undefined,
                reservedTurnIndex:
                  progressive && reservedTurnMinHeight !== null
                    ? presentedTurnCount - 1
                    : undefined,
                animatedTurnIndex:
                  progressive && animateNewest
                    ? presentedTurnCount - 1
                    : undefined,
                animationEnabled: progressive && animateNewest,
                textAnimationEnabled: progressive && typing,
                onAnimationComplete: () => {
                  setAnimateNewest(false);
                  setTyping(false);
                },
                timedReveal:
                  audioEnabled &&
                  audioAutoPlay &&
                  !audioFallback &&
                  activeAudioContentKey
                    ? {
                        contentKey: activeAudioContentKey,
                        revealedLength: revealedLength ?? 0,
                        onSkip: revealCurrentText,
                      }
                    : undefined,
                renderNarrationAudioControl: audioEnabled
                  ? renderNarrationAudioControl
                  : undefined,
              }}
            />
          </div>
        </div>
        {musicError && (
          <p role="alert">
            {t("desktop.ui.assistantSectionMaterial.couldNotStartPlayback")}
            {musicError}
          </p>
        )}
      </section>
    </MusicTimelineContext.Provider>
  );
}
