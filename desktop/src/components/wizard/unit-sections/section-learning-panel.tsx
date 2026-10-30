"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applyMaterialDelta } from "@xue-learn/core/contracts";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Circle,
  LoaderCircle,
  MoreHorizontal,
  Puzzle,
  RotateCcw,
  Sparkles,
  Square,
} from "lucide-react";
import { Button, buttonVariants } from "@xue-learn/core/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AnchoredLearningMaterial } from "@/components/wizard/anchored-learning-material";
import type {
  MaterialCheckResult,
  VerifiedMaterialAnswerHandler,
} from "@/components/wizard/interactive-material/types";
import { apiGet, apiPost, type UnitSectionManifest } from "@/shared/api";
import type { LearningMaterialContent } from "@xue-learn/core/schemas";
import { cn } from "@xue-learn/core/utils";
import { loadUnitSectionStableContent } from "@/shared/api/unit-content";
import { consumeSsePost } from "@/shared/client/consume-sse";
import { getAuthUser } from "@/shared/auth";
import { useTeachingPersonas } from "@/hooks/api/use-teaching-personas";
import { teachingPersonaAvatarSrc } from "@/shared/teaching-persona-avatar";
import { localizeTeachingPersonaName } from "@/shared/teaching-persona-i18n";
import { isChatAudioFeatureEnabled } from "@xue-learn/core/features";
import { AssistantSectionMaterial } from "./assistant-section-material.tsx";
import { TopicRegenButton } from "./topic-regen-button.tsx";
import { FormalDerivationSection } from "./formal-derivation-section.tsx";
import { PendingTeachingPresentation } from "@/features/teaching-derivation/pending-presentation";
import { TeachingDerivationPlayer } from "@/features/teaching-derivation/teaching-derivation-player";
import {
  parseDerivationDocument,
  type DerivationDocumentV1,
} from "@xue-learn/core/formal-derivation";
import {
  parseTeachingDerivationDocument,
  type TeachingDerivationDerivedV1,
  type TeachingDerivationDocumentV1,
} from "@xue-learn/core/teaching-derivation";
import { ConversationTypingIndicator } from "../conversation/learning-conversation-surface.tsx";
import { LlmMarkdownInline } from "@/components/markdown/llm-markdown";
import type { ChatNarrationAsset } from "@/shared/audio/chat-narration";
import { useT } from "@xue-learn/core/i18n";
import { useConfirm } from "@/hooks/use-confirm";
import {
  isDesktopLocalRuntime,
  supportsChatAudioGeneration,
} from "@xue-learn/core/client-runtime";
import {
  resolveSectionMaterialForRender,
  shouldKeepVisibleSectionMaterial,
  shouldPreservePublishedSectionContent,
} from "./section-material-reconciliation.ts";
import {
  sectionGenerateStreamBody,
  shouldClearSectionContentBeforeGenerate,
  shouldStartSectionGenerateStream,
} from "@/shared/domain/section-generation-retry";
import { ReadingSectionBody } from "@/features/reading/reading-course-view";

type SectionContent = {
  sectionId: string;
  contentRevision: number;
  blockOffset: number;
  material: LearningMaterialContent | null;
  contentKind?: "standard" | "formal_derivation";
  derivation?: DerivationDocumentV1 | null;
  derivationFormat?: "classic" | "teaching_v1" | null;
  teachingDerivation?: TeachingDerivationDocumentV1 | null;
  teachingDerivationDerived?: TeachingDerivationDerivedV1 | null;
};

function SectionPrepareRetryButton({
  busy,
  preparingLabel,
  retryLabel,
  onRetry,
}: {
  busy: boolean;
  preparingLabel: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(buttonVariants({ size: "sm" }), "relative z-20 shrink-0")}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onRetry();
      }}
    >
      <RotateCcw className={busy ? "animate-spin" : undefined} aria-hidden />
      {busy ? preparingLabel : retryLabel}
    </button>
  );
}

function SectionRegenerateAction({
  busy,
  onRegenerate,
}: {
  busy: boolean;
  onRegenerate: () => void;
}) {
  const t = useT();
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="hidden md:inline-flex"
        disabled={busy}
        onClick={onRegenerate}
      >
        <RotateCcw className={busy ? "animate-spin" : undefined} aria-hidden />
        {t("wizard.section.regenerateSection")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="md:hidden"
              disabled={busy}
              aria-label={t("goals.moreActions")}
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onRegenerate}>
            <RotateCcw aria-hidden />
            {t("wizard.section.regenerateSection")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function SectionLearningPanel({
  unitId,
  goalId,
  isOverview = false,
  initialSections,
  initialSectionId,
  initialAnchor,
  regenerating = false,
  previewMaterial = null,
  assessmentLocked,
  materialCheckResults = [],
  onVerifiedAnswer,
  onSubmitSectionMiniTest,
  onSectionsChanged,
  onAllSectionsCompleted,
  onStopGeneration,
  presentationMode = "reading",
  bodyMode = "chat",
  miniTestDrafts = {},
  onMiniTestDraftChange,
  onActiveSectionChange,
  sectionCursors = {},
  onSectionCursorChange,
}: {
  unitId: string;
  goalId: string;
  isOverview?: boolean;
  initialSections: UnitSectionManifest[];
  initialSectionId?: string | null;
  initialAnchor?: string | null;
  regenerating?: boolean;
  previewMaterial?: LearningMaterialContent | null;
  assessmentLocked?: boolean;
  materialCheckResults?: MaterialCheckResult[];
  onVerifiedAnswer?: VerifiedMaterialAnswerHandler;
  onSubmitSectionMiniTest?: (input: {
    sectionId: string;
    answers: Record<string, number | number[] | boolean>;
  }) => Promise<{ score: number; results: MaterialCheckResult[] } | null>;
  onSectionsChanged?: (sections: UnitSectionManifest[]) => void;
  onAllSectionsCompleted?: () => void;
  onStopGeneration?: () => void | Promise<void>;
  presentationMode?: "chat" | "reading";
  bodyMode?: "chat" | "reading";
  miniTestDrafts?: Record<string, Record<string, number | number[] | boolean>>;
  onMiniTestDraftChange?: (
    sectionId: string,
    answers: Record<string, number | number[] | boolean>,
  ) => void;
  onActiveSectionChange?: (sectionId: string) => void;
  sectionCursors?: Record<string, { contentRevision: number; cursor: number }>;
  onSectionCursorChange?: (
    sectionId: string,
    contentRevision: number,
    cursor: number,
  ) => void;
}) {
  const t = useT();
  const { confirm } = useConfirm();
  const conversationMode = presentationMode === "chat";
  const chatAudioEligible =
    isChatAudioFeatureEnabled(isDesktopLocalRuntime()) &&
    supportsChatAudioGeneration();
  const [sections, setSections] = useState(initialSections);
  const resolveOpenIndex = useCallback(
    (
      sectionList: UnitSectionManifest[],
      sectionId: string | null | undefined,
    ) => {
      const requested = sectionId
        ? sectionList.findIndex((section) => section.id === sectionId)
        : -1;
      if (requested >= 0) return requested;
      const unfinished = sectionList.findIndex(
        (section) =>
          section.status !== "completed" && section.status !== "skipped",
      );
      return unfinished >= 0 ? unfinished : Math.max(0, sectionList.length - 1);
    },
    [],
  );
  const [activeIndex, setActiveIndex] = useState(() =>
    resolveOpenIndex(initialSections, initialSectionId),
  );
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const [content, setContent] = useState<SectionContent | null>(null);
  const [busy, setBusy] = useState<
    "load" | "generate" | "complete" | "skip" | null
  >(null);
  const [error, setError] = useState("");
  const [verifyingContent, setVerifyingContent] = useState(false);
  const [regeneratingTopicIndex, setRegeneratingTopicIndex] = useState<
    number | null
  >(null);
  const [sceneTopicIdentity, setSceneTopicIdentity] = useState<{
    topicId?: string;
    topicIndex: number;
  } | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stoppedSectionId, setStoppedSectionId] = useState<string | null>(null);
  const [pendingAnswers, setPendingAnswers] = useState<
    Record<string, number | number[] | boolean>
  >({});
  const [submittingMiniTest, setSubmittingMiniTest] = useState(false);
  const [narrationAssets, setNarrationAssets] = useState<ChatNarrationAsset[]>(
    [],
  );
  const teachingPersonas = useTeachingPersonas({ goalId });
  const assistantName = localizeTeachingPersonaName(
    teachingPersonas.data?.current,
    t,
  );
  const assistantAvatarSrc = teachingPersonaAvatarSrc(
    teachingPersonas.data?.current.avatarCode ?? "xiaohui_female",
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const assistantSectionRef = useRef<HTMLElement>(null);
  const onActiveSectionChangeRef = useRef(onActiveSectionChange);
  const pendingAnswersRef = useRef(pendingAnswers);
  pendingAnswersRef.current = pendingAnswers;
  const loadRequestRef = useRef(0);
  const generationAbortRef = useRef<AbortController | null>(null);
  const parentRegenerationHandledRef = useRef(false);
  const sectionLoadRef = useRef<{
    sectionId: string;
    requestId: number;
  } | null>(null);
  const active = sections[activeIndex];
  const readingBody = bodyMode === "reading" && isDesktopLocalRuntime() && active?.sectionKind === "content";
  const [visitedBodies, setVisitedBodies] = useState({sectionId: active?.id, reading: readingBody, display: !readingBody});
  useEffect(() => {
    setVisitedBodies(previous => ({
      sectionId: active?.id,
      reading: readingBody || (previous.sectionId === active?.id && previous.reading),
      display: !readingBody || (previous.sectionId === active?.id && previous.display),
    }));
  }, [active?.id, readingBody]);
  const renderReading = active?.sectionKind === "content" &&
    (readingBody || (visitedBodies.sectionId === active.id && visitedBodies.reading));
  const renderDisplay = !readingBody || (visitedBodies.sectionId === active?.id && visitedBodies.display);
  const updateActiveMaterial = useCallback(
    (material: LearningMaterialContent) => {
      setContent((current) =>
        current && current.sectionId === active?.id
          ? { ...current, material }
          : current,
      );
    },
    [active?.id],
  );
  const goToSectionIndex = useCallback(
    (nextIndex: number, sectionList: UnitSectionManifest[]) => {
      const clamped = Math.max(
        0,
        Math.min(nextIndex, Math.max(0, sectionList.length - 1)),
      );
      const target = sectionList[clamped];
      // Update the URL before local index so a later manifest refresh cannot
      // resurrect the previous ?section= and undo navigation.
      if (target?.id) onActiveSectionChangeRef.current?.(target.id);
      setActiveIndex(clamped);
    },
    [],
  );
  const contentRef = useRef(content);
  contentRef.current = content;

  useEffect(() => {
    onActiveSectionChangeRef.current = onActiveSectionChange;
  }, [onActiveSectionChange]);

  useEffect(() => {
    // Notify only when the active section changes. A URL-driven selection also
    // recreates the callback; reporting the old section during that render
    // would overwrite the requested section and bounce between both views.
    if (active?.id) onActiveSectionChangeRef.current?.(active.id);
  }, [active?.id]);

  useEffect(() => {
    setSceneTopicIdentity(null);
  }, [active?.id]);

  useEffect(() => {
    const loadingSectionId = sectionLoadRef.current?.sectionId;
    if (!loadingSectionId) {
      setSections(initialSections);
      return;
    }
    // A query refresh can briefly deliver the manifest from before a retry.
    // Preserve the in-flight section while still accepting sibling updates.
    setSections((current) =>
      initialSections.map((section) =>
        section.id === loadingSectionId
          ? (current.find((item) => item.id === section.id) ?? section)
          : section,
      ),
    );
  }, [initialSections]);

  // Only follow explicit URL/section selection changes. Refreshing the section
  // manifest after complete must not snap activeIndex back to the old ?section=.
  useEffect(() => {
    setActiveIndex(resolveOpenIndex(initialSections, initialSectionId));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- omit initialSections on purpose
  }, [initialSectionId, resolveOpenIndex]);

  useEffect(() => {
    const next = active?.id ? (miniTestDrafts[active.id] ?? {}) : {};
    pendingAnswersRef.current = next;
    setPendingAnswers(next);
    setSubmittingMiniTest(false);
  }, [active?.id, miniTestDrafts]);

  useEffect(() => {
    setNarrationAssets([]);
  }, [active?.id]);

  const updatePendingAnswers = useCallback(
    (
      update: (
        current: Record<string, number | number[] | boolean>,
      ) => Record<string, number | number[] | boolean>,
    ) => {
      // Compute next outside any setState updater so the parent draft sync
      // does not update UnitWizard while SectionLearningPanel is rendering.
      const next = update(pendingAnswersRef.current);
      pendingAnswersRef.current = next;
      setPendingAnswers(next);
      if (active?.id) onMiniTestDraftChange?.(active.id, next);
    },
    [active?.id, onMiniTestDraftChange],
  );

  const refreshManifest = useCallback(async () => {
    const next = await apiGet<UnitSectionManifest[]>(
      `/api/units/${unitId}/sections`,
    );
    setSections(next);
    onSectionsChanged?.(next);
    return next;
  }, [onSectionsChanged, unitId]);

  const loadContent = useCallback(
    async (
      section: UnitSectionManifest,
      generateWhenMissing = true,
      options?: {
        force?: boolean;
        resume?: boolean;
        rewrite?: { topicId?: string; topicIndex: number };
        derivationFormat?: "classic" | "teaching_v1";
      },
    ) => {
      const force = Boolean(options?.force);
      const resume = Boolean(options?.resume);
      const rewrite = options?.rewrite;
      const derivationFormat = options?.derivationFormat;
      const requestId = ++loadRequestRef.current;
      // Claim the whole load, including the initial content lookup. Waiting
      // until SSE starts leaves a window where a manifest/URL update can start
      // a duplicate request that aborts the real generation.
      sectionLoadRef.current = { sectionId: section.id, requestId };
      const preserveVisible =
        !shouldClearSectionContentBeforeGenerate({
          force,
          rewrite: Boolean(rewrite),
        }) &&
        contentRef.current?.sectionId === section.id &&
        Boolean(
          contentRef.current.material ||
          contentRef.current.derivation ||
          contentRef.current.teachingDerivation,
        );
      if (!preserveVisible) setBusy("load");
      if (!(section.generationStatus === "failed" && !generateWhenMissing)) {
        setError("");
      }
      try {
        let next: SectionContent;
        if (
          shouldClearSectionContentBeforeGenerate({
            force,
            rewrite: Boolean(rewrite),
          })
        ) {
          next = {
            sectionId: section.id,
            contentRevision: section.contentRevision,
            blockOffset: 0,
            material: null,
            derivation: null,
            teachingDerivation: null,
            teachingDerivationDerived: null,
          };
          setContent(next);
        } else if (section.generationStatus === "ready") {
          next = (await loadUnitSectionStableContent(
            unitId,
            section.id,
            section.contentRevision,
          )) as SectionContent;
        } else {
          next = await apiGet<SectionContent>(
            `/api/units/${unitId}/sections/${encodeURIComponent(section.id)}/content`,
          );
        }
        if (
          shouldStartSectionGenerateStream({
            generateWhenMissing,
            force,
            rewrite: Boolean(rewrite),
            resume,
            generationStatus: section.generationStatus,
            hasStoredContent: Boolean(
              next.material || next.derivation || next.teachingDerivation,
            ),
            pendingDerivation:
              section.contentKind === "formal_derivation" &&
              section.generationStatus === "pending" &&
              Boolean(next.derivation || next.teachingDerivation),
          })
        ) {
          setBusy("generate");
          const controller = new AbortController();
          generationAbortRef.current?.abort();
          generationAbortRef.current = controller;
          await consumeSsePost(
            `/api/units/${unitId}/sections/${encodeURIComponent(section.id)}/generate/stream`,
            sectionGenerateStreamBody({
              force,
              rewrite,
              derivationFormat:
                derivationFormat ??
                (section.derivationFormat === "teaching_v1"
                  ? "teaching_v1"
                  : undefined),
            }),
            (event) => {
              if (loadRequestRef.current !== requestId) return;
              if (event.type === "narration_audio_ready") {
                const asset = event.asset as ChatNarrationAsset;
                setNarrationAssets((current) => [
                  ...current.filter(
                    (item) => item.contentKey !== asset.contentKey,
                  ),
                  asset,
                ]);
                return;
              }
              if (event.type === "content_verification") {
                setVerifyingContent(event.state === "verifying");
                return;
              }
              if (
                event.type === "content_repair" &&
                event.artifactKind === "mini_test"
              ) {
                setContent((current) => {
                  if (!current?.material) return current;
                  const blocks = [...current.material.blocks];
                  const checkIndexes = blocks.flatMap((block, index) =>
                    block.type === "check" ? [index] : [],
                  );
                  for (const patch of event.patches) {
                    const blockIndex = checkIndexes[patch.index];
                    if (blockIndex !== undefined) {
                      blocks[blockIndex] =
                        patch.content as (typeof blocks)[number];
                    }
                  }
                  return {
                    ...current,
                    material: { ...current.material, blocks },
                  };
                });
                return;
              }
              if (event.type === "material_partial") {
                setContent({
                  ...next,
                  material: event.material as LearningMaterialContent,
                });
              } else if (event.type === "material_delta") {
                setContent((current) => ({
                  ...(current ?? next),
                  material: applyMaterialDelta(
                    event.reset ? null : (current?.material ?? null),
                    event.delta,
                  ) as LearningMaterialContent,
                }));
              } else if (event.type === "derivation_partial") {
                try {
                  const document = parseDerivationDocument(event.derivation);
                  if (document.steps.length === 0) return;
                  setContent({
                    ...next,
                    derivation: document,
                  });
                } catch {
                  return;
                }
              } else if (event.type === "teaching_derivation_partial") {
                const document = parseTeachingDerivationDocument(
                  event.teachingDerivation,
                );
                if (!document || document.steps.length === 0) return;
                setContent({
                  ...next,
                  teachingDerivation: document,
                  teachingDerivationDerived:
                    (event.derived as TeachingDerivationDerivedV1 | null) ??
                    null,
                  derivationFormat: "teaching_v1",
                });
              }
            },
            controller.signal,
          );
          if (generationAbortRef.current === controller) {
            generationAbortRef.current = null;
          }
          const refreshed = await refreshManifest();
          const readySection =
            refreshed.find((item) => item.id === section.id) ?? section;
          next = (await loadUnitSectionStableContent(
            unitId,
            section.id,
            readySection.contentRevision,
          )) as SectionContent;
        }
        if (loadRequestRef.current === requestId) setContent(next);
      } catch (cause) {
        if (loadRequestRef.current === requestId) {
          setError(
            cause instanceof Error
              ? cause.message
              : t("wizard.section.prepareFailed"),
          );
          await refreshManifest().catch(() => undefined);
        }
      } finally {
        if (loadRequestRef.current === requestId) {
          setBusy(null);
          setVerifyingContent(false);
          setRegeneratingTopicIndex(null);
        }
        if (sectionLoadRef.current?.requestId === requestId) {
          sectionLoadRef.current = null;
        }
      }
    },
    [refreshManifest, t, unitId],
  );

  const reloadActiveSection = useCallback(async () => {
    if (!active || active.legacy) return;
    const refreshed = await refreshManifest();
    const next = refreshed.find((section) => section.id === active.id);
    if (!next) return;
    setContent(null);
    await loadContent(next, false);
  }, [active, loadContent, refreshManifest]);

  useEffect(() => {
    if (!active || active.legacy || regenerating || readingBody) return;
    if (sectionLoadRef.current?.sectionId === active.id) return;
    if (active.generationStatus === "failed") {
      if (active.generationError === "生成已停止") {
        setStoppedSectionId(active.id);
        setContent(null);
        setError(t("wizard.section.generationStoppedMessage"));
      } else {
        // Keep the last streamed draft on screen. A verifier/publication
        // failure must not silently start another expensive authoring call.
        setError(t("wizard.section.prepareFailedFriendly"));
        const hasDraft = Boolean(
          contentRef.current?.sectionId === active.id &&
          (contentRef.current.material ||
            contentRef.current.derivation ||
            contentRef.current.teachingDerivation),
        );
        if (!hasDraft) void loadContent(active, false);
      }
      return;
    }
    if (stoppedSectionId === active.id) return;
    // refreshManifest publishes the final revision while loadContent is still
    // replacing the streamed draft. Do not start a second load that clears the
    // visible chat and remounts it at turn one.
    const currentContent = contentRef.current;
    if (
      shouldKeepVisibleSectionMaterial({
        activeSectionId: active.id,
        contentSectionId: currentContent?.sectionId,
        hasMaterial: Boolean(
          currentContent?.material ||
          currentContent?.derivation ||
          currentContent?.teachingDerivation,
        ),
      })
    ) {
      if (
        active.generationStatus === "ready" &&
        currentContent?.contentRevision !== active.contentRevision
      ) {
        void loadContent(active, false);
      }
      return;
    }
    setContent(null);
    void loadContent(active);
  }, [
    active?.contentRevision,
    active?.generationError,
    active?.generationStatus,
    active?.id,
    loadContent,
    regenerating,
    readingBody,
    stoppedSectionId,
    t,
  ]);

  useEffect(
    () => () => {
      generationAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (readingBody) return;
    if (!regenerating) {
      parentRegenerationHandledRef.current = false;
      return;
    }
    // A restored parent generation can remain "loading" briefly while its
    // failed run is being reconciled. Once the section manifest is failed,
    // recovery is the only useful action; do not leave its button spinning
    // and disabled behind the stale parent state.
    if (active?.generationStatus === "failed") {
      parentRegenerationHandledRef.current = true;
      setBusy((current) => (current === "generate" ? null : current));
      return;
    }
    // A tracked run can remain active briefly after the section transaction
    // has already published. On refresh, keep that SQLite-backed canonical
    // content instead of clearing it in favor of an absent stream preview.
    if (
      shouldPreservePublishedSectionContent({
        generationStatus: active?.generationStatus,
        activeSectionId: active?.id,
        contentSectionId: contentRef.current?.sectionId,
        material: contentRef.current?.material,
        derivation: contentRef.current?.derivation,
      })
    ) {
      parentRegenerationHandledRef.current = true;
      setBusy((current) => (current === "generate" ? null : current));
      return;
    }
    if (parentRegenerationHandledRef.current) return;
    // A section retry/load already owns this request. Bumping the request id
    // here would abort generate/stream without starting a replacement.
    if (sectionLoadRef.current?.sectionId === active?.id) return;
    parentRegenerationHandledRef.current = true;
    loadRequestRef.current += 1;
    setActiveIndex(0);
    setContent(null);
    setError("");
    setBusy("generate");
  }, [active?.generationStatus, regenerating, readingBody]);

  useEffect(() => {
    if (!active || active.legacy) return;
    let pendingSeconds = 0;
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        pendingSeconds += 1;
      }
    }, 1_000);
    const flush = () => {
      if (pendingSeconds <= 0) return;
      const activeSeconds = pendingSeconds;
      pendingSeconds = 0;
      void apiPost(`/api/units/${unitId}/session`, {
        action: "touch_activity",
        payload: {
          tab: "material",
          sectionId: active.id,
          activeSeconds,
          timeFlush: true,
        },
      }).catch(() => undefined);
    };
    const heartbeat = window.setInterval(flush, 30_000);
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", flush);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [active?.id, active?.legacy, unitId]);

  useEffect(() => {
    if (!initialAnchor || !content?.material) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(initialAnchor)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [content?.material, initialAnchor]);

  if (!active || sections.length === 0) return null;

  const priorComplete = (index: number) =>
    sections
      .slice(0, index)
      .every(
        (section) =>
          section.status === "completed" || section.status === "skipped",
      );
  const completedCount = sections.filter(
    (section) => section.status === "completed" || section.status === "skipped",
  ).length;
  const requiredQuestionIds =
    active.sectionKind === "mini_test"
      ? (content?.material?.blocks.flatMap((block) => {
          const checkId = (block as { checkId?: unknown }).checkId;
          return block.type === "check" &&
            typeof checkId === "string" &&
            checkId
            ? [checkId]
            : [];
        }) ?? [])
      : [];
  const answeredQuestionIds = new Set(
    materialCheckResults.map((result) => result.checkId),
  );
  const answeredQuestionCount = requiredQuestionIds.filter((checkId) =>
    answeredQuestionIds.has(checkId),
  ).length;
  const questionsComplete =
    requiredQuestionIds.length === 0 ||
    answeredQuestionCount === requiredQuestionIds.length;
  const nextSection = sections[activeIndex + 1];
  const finishActionLabel =
    active.sectionKind === "content"
      ? nextSection?.sectionKind === "mini_test"
        ? t("wizard.section.finishStartQuiz")
        : nextSection
          ? t("wizard.section.finishContinueNext")
          : t("wizard.section.finishEnterGuidingQuestions")
      : !questionsComplete
        ? t("wizard.section.submitGradeThenContinue")
        : nextSection
          ? t("wizard.section.continueNext")
          : t("wizard.section.finishEnterGuidingQuestions");
  const isMiniTest = active.sectionKind === "mini_test";
  const deferredMiniTest =
    isMiniTest && !questionsComplete && Boolean(onSubmitSectionMiniTest);
  const selectedQuestionCount = requiredQuestionIds.filter((checkId) =>
    Object.prototype.hasOwnProperty.call(pendingAnswers, checkId),
  ).length;
  const allSelected =
    requiredQuestionIds.length > 0 &&
    selectedQuestionCount === requiredQuestionIds.length;
  const materialForRender = resolveSectionMaterialForRender({
    regenerating,
    preview: previewMaterial,
    persisted: content?.material,
  });
  const derivationForRender = content?.derivation ?? null;
  const teachingDerivationForRender = content?.teachingDerivation ?? null;
  const hasRenderableContent = Boolean(
    materialForRender || derivationForRender || teachingDerivationForRender,
  );
  const activeContentRevision =
    content?.contentRevision ?? active?.contentRevision ?? 0;
  const storedAssistantCursor = active ? sectionCursors[active.id] : undefined;
  const miniTestMaterialForRender =
    isMiniTest && materialForRender
      ? {
          ...materialForRender,
          introduction: "",
          blocks: materialForRender.blocks.filter(
            (block) => block.type !== "heading",
          ),
          keyTakeaways: [],
        }
      : materialForRender;
  const localAnswerHandler: VerifiedMaterialAnswerHandler | undefined =
    deferredMiniTest
      ? (input) => {
          if (!input.checkId) return null;
          updatePendingAnswers((current) => ({
            ...current,
            [input.checkId!]: input.answer,
          }));
          return null;
        }
      : onVerifiedAnswer
        ? (input) =>
            onVerifiedAnswer({
              ...input,
              blockIndex: input.blockIndex + (content?.blockOffset ?? 0),
            })
        : undefined;

  const submitMiniTest = async () => {
    if (
      !deferredMiniTest ||
      !onSubmitSectionMiniTest ||
      !allSelected ||
      submittingMiniTest ||
      assessmentLocked
    ) {
      return;
    }
    setSubmittingMiniTest(true);
    setError("");
    try {
      const answers: Record<string, number | number[] | boolean> = {};
      for (const checkId of requiredQuestionIds) {
        answers[checkId] = pendingAnswers[checkId]!;
      }
      const result = await onSubmitSectionMiniTest({
        sectionId: active.id,
        answers,
      });
      if (!result) {
        setError(t("wizard.section.quizSubmitFailed"));
      } else {
        updatePendingAnswers(() => ({}));
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("wizard.section.quizSubmitFailed"),
      );
    } finally {
      setSubmittingMiniTest(false);
    }
  };

  const finish = async (skip: boolean) => {
    if (skip && !window.confirm(t("wizard.section.skipConfirmation"))) {
      return;
    }
    const finishingId = active.id;
    const fromIndex = activeIndexRef.current;
    setBusy(skip ? "skip" : "complete");
    setError("");
    try {
      // Prefer session actions (sectionId in body) so virtual mini-test ids
      // never depend on path-param decoding of `mini-test:…`.
      const result = await apiPost<{
        sections?: UnitSectionManifest[];
        currentSectionId?: string | null;
      }>(`/api/units/${unitId}/session`, {
        action: skip ? "skip_section" : "complete_section",
        payload: { sectionId: finishingId },
      });
      let next: UnitSectionManifest[];
      if (Array.isArray(result.sections) && result.sections.length > 0) {
        next = result.sections;
        setSections(next);
        onSectionsChanged?.(next);
      } else {
        next = await refreshManifest();
      }
      const allDone = next.every(
        (section) =>
          section.status === "completed" || section.status === "skipped",
      );
      if (allDone) {
        onAllSectionsCompleted?.();
        return;
      }
      const preferredId =
        typeof result.currentSectionId === "string"
          ? result.currentSectionId
          : null;
      const preferredIndex = preferredId
        ? next.findIndex((section) => section.id === preferredId)
        : -1;
      const fallbackIndex = next.findIndex(
        (section, index) =>
          index > fromIndex &&
          section.status !== "completed" &&
          section.status !== "skipped",
      );
      goToSectionIndex(
        preferredIndex >= 0
          ? preferredIndex
          : fallbackIndex >= 0
            ? fallbackIndex
            : Math.min(fromIndex + 1, next.length - 1),
        next,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("wizard.section.completeFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  const stopGeneration = async () => {
    if (busy !== "generate" || stopping) return;
    const sectionId = active.id;
    const requestId = ++loadRequestRef.current;
    setStopping(true);
    try {
      const result = await apiPost<{ cancelled: boolean }>(
        `/api/units/${unitId}/sections/${encodeURIComponent(sectionId)}/generate/cancel`,
      );
      await Promise.resolve(onStopGeneration?.()).catch(() => undefined);
      generationAbortRef.current?.abort();
      generationAbortRef.current = null;
      setBusy(null);
      const next = await refreshManifest();
      const current = next.find((section) => section.id === sectionId);
      if (result.cancelled) {
        setStoppedSectionId(sectionId);
        setContent(null);
        setError(t("wizard.section.generationStoppedMessage"));
      } else if (current?.generationStatus === "ready") {
        setStoppedSectionId(null);
        setError("");
        await loadContent(current, false);
      } else {
        setError(t("wizard.section.noStoppableGeneration"));
      }
    } catch (cause) {
      if (loadRequestRef.current === requestId) {
        setBusy(null);
        setError(
          cause instanceof Error
            ? cause.message
            : t("wizard.section.stopGenerationFailed"),
        );
      }
    } finally {
      setStopping(false);
    }
  };

  const retryGeneration = () => {
    if (!active || sectionLoadRef.current?.sectionId === active.id) return;
    const retrySection: UnitSectionManifest = {
      ...active,
      generationStatus: "pending",
      generationError: "",
    };
    setStoppedSectionId(null);
    setError("");
    const nextSections = sections.map((section) =>
      section.id === active.id ? retrySection : section,
    );
    setSections(nextSections);
    onSectionsChanged?.(nextSections);
    void loadContent(retrySection, true, { resume: true });
  };

  const regenerateReadySection = async () => {
    if (!active || active.sectionKind !== "content" || busy) return;
    const ok = await confirm({
      title: t("wizard.section.regenerateSectionTitle"),
      description: t("wizard.section.regenerateSectionDescription"),
      variant: "destructive",
      confirmLabel: t("wizard.material.regenerate"),
    });
    if (!ok) return;
    const retrySection: UnitSectionManifest = {
      ...active,
      generationStatus: "pending",
      generationError: "",
    };
    setStoppedSectionId(null);
    setError("");
    setSections((current) =>
      current.map((section) =>
        section.id === active.id ? retrySection : section,
      ),
    );
    void loadContent(retrySection, true, { force: true });
  };

  const regenerateTopic = async (identity: {
    topicId?: string;
    topicIndex: number;
  }) => {
    if (!active || active.sectionKind !== "content" || busy) return;
    const ok = await confirm({
      title: t("wizard.section.regenerateTopicTitle"),
      description: t("wizard.section.regenerateTopicDescription"),
      variant: "destructive",
      confirmLabel: t("wizard.material.regenerate"),
    });
    if (!ok) return;
    setStoppedSectionId(null);
    setError("");
    setRegeneratingTopicIndex(identity.topicIndex);
    void loadContent(active, true, { rewrite: identity });
  };

  const continueFromCompletedSection = () => {
    if (activeIndex >= sections.length - 1) {
      onAllSectionsCompleted?.();
      return;
    }
    goToSectionIndex(activeIndex + 1, sections);
  };

  if (conversationMode) {
    const userId = getAuthUser()?.id ?? "anonymous";
    const hasGeneratedMiniTest =
      active.sectionKind === "content" &&
      nextSection?.sectionKind === "mini_test" &&
      nextSection.generationStatus === "ready";
    const activeSectionNumber =
      sections
        .slice(0, activeIndex + 1)
        .filter((section) => section.sectionKind === "content").length || 1;

    const generationError = Boolean(error) && !hasRenderableContent;

    // Keep each teaching section and its mini-test as separate chat views.
    // The journey remains available for returning to the preceding section.
    return (
      <div className="min-w-0 space-y-8 pb-12">
        {renderReading && <div hidden={!readingBody} data-course-mode="reading">
          <ReadingSectionBody key={active.id} unitId={unitId} sectionId={active.id} goalId={goalId} active={readingBody}
            continuing={busy === "complete"}
            continueLabel={finishActionLabel}
            onContinue={() => active.status === "completed" || active.status === "skipped"
              ? continueFromCompletedSection() : void finish(false)} />
          {readingBody && error && active.generationStatus !== "failed" && <p role="alert" className="reading-error">{error}</p>}
        </div>}
        {renderDisplay && <div hidden={readingBody} data-course-mode="display">
        {verifyingContent ? (
          <div className="mx-auto w-full max-w-[48rem] rounded-xl border border-[var(--brand-200)] bg-[var(--brand-50)] px-4 py-3 text-sm text-[var(--brand-700)]">
            {t("wizard.section.verifyingContent")}
          </div>
        ) : null}
        {isDesktopLocalRuntime() && error ? (
          <PendingTeachingPresentation
            unitId={unitId}
            sectionId={active.id}
            errorKey={error}
            onAccepted={retryGeneration}
          />
        ) : null}
        {error && hasRenderableContent ? (
          <div className="mx-auto flex w-full max-w-[48rem] flex-col gap-3 rounded-xl border border-[var(--error-200)] bg-[var(--error-50)] p-4 text-sm text-[var(--error-600)] sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <SectionPrepareRetryButton
              busy={busy === "generate"}
              preparingLabel={t("wizard.section.preparingCurrentSection")}
              retryLabel={t("wizard.section.prepareAgain")}
              onRetry={retryGeneration}
            />
          </div>
        ) : null}
        {generationError ? (
          <div
            role="alert"
            className="mx-auto flex w-full max-w-[40rem] flex-col gap-4 rounded-2xl border border-[var(--border-200)] bg-[var(--bg-50)] p-4 text-foreground shadow-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--error-50)] text-[var(--error-600)]">
                <CircleAlert className="size-4.5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {t("wizard.section.prepareFailed")}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {error}
                </p>
              </div>
            </div>
            <SectionPrepareRetryButton
              busy={busy === "generate"}
              preparingLabel={t("wizard.section.preparingCurrentSection")}
              retryLabel={t("wizard.section.prepareAgain")}
              onRetry={retryGeneration}
            />
          </div>
        ) : !hasRenderableContent ? (
          <ConversationTypingIndicator>
            {busy === "generate"
              ? active.sectionKind === "mini_test"
                ? t("wizard.section.generatingQuizFromPrevious")
                : active.contentKind === "formal_derivation"
                  ? t("wizard.section.preparingDerivation")
                  : t("wizard.section.preparingUpcomingContent")
              : t("wizard.section.loadingLearningContent")}
          </ConversationTypingIndicator>
        ) : active.sectionKind === "content" && teachingDerivationForRender ? (
          <div className="mx-auto flex w-full max-w-[58rem] min-h-[32rem] flex-col">
            <div className="mb-1 flex items-center justify-end gap-2">
              {busy === "generate" ? (
                <p className="mr-auto min-w-0 text-xs text-muted-foreground">
                  {t("wizard.section.continuingDerivation")}
                </p>
              ) : null}
              <SectionRegenerateAction
                busy={Boolean(busy)}
                onRegenerate={() => void regenerateReadySection()}
              />
            </div>
            <TeachingDerivationPlayer
              key={active.id}
              document={teachingDerivationForRender}
              presentationContext={{
                unitId,
                sectionId: active.id,
                revision: activeContentRevision,
                onUpdated: reloadActiveSection,
              }}
              derived={content?.teachingDerivationDerived ?? null}
              assistantName={assistantName}
              assistantAvatarSrc={assistantAvatarSrc}
              busy={busy === "load" || busy === "complete"}
              generating={busy === "generate"}
              onContinue={() =>
                active.status === "completed" || active.status === "skipped"
                  ? continueFromCompletedSection()
                  : finish(false)
              }
              persistedCursor={
                storedAssistantCursor?.contentRevision === activeContentRevision
                  ? storedAssistantCursor.cursor
                  : undefined
              }
              onCursorChange={(cursor) =>
                onSectionCursorChange?.(
                  active.id,
                  activeContentRevision,
                  cursor,
                )
              }
            />
          </div>
        ) : active.sectionKind === "content" && derivationForRender ? (
          <div className="mx-auto flex w-full max-w-[58rem] min-h-[32rem] flex-col">
            <div className="mb-1 flex items-center justify-end gap-2">
              {busy === "generate" ? (
                <p className="mr-auto min-w-0 text-xs text-muted-foreground">
                  {t("wizard.section.continuingDerivation")}
                </p>
              ) : null}
              <SectionRegenerateAction
                busy={Boolean(busy)}
                onRegenerate={() => void regenerateReadySection()}
              />
            </div>
            <FormalDerivationSection
              key={active.id}
              document={derivationForRender}
              assistantName={assistantName}
              assistantAvatarSrc={assistantAvatarSrc}
              busy={busy === "load" || busy === "complete"}
              generating={busy === "generate"}
              onContinue={() =>
                active.status === "completed" || active.status === "skipped"
                  ? continueFromCompletedSection()
                  : finish(false)
              }
              persistedCursor={
                storedAssistantCursor?.contentRevision === activeContentRevision
                  ? storedAssistantCursor.cursor
                  : undefined
              }
              onCursorChange={(cursor) =>
                onSectionCursorChange?.(
                  active.id,
                  activeContentRevision,
                  cursor,
                )
              }
            />
          </div>
        ) : active.sectionKind === "content" ? (
          <div className="mx-auto w-full max-w-[90rem] space-y-3">
            <div className="flex flex-wrap justify-end gap-1">
              <SectionRegenerateAction
                busy={Boolean(busy)}
                onRegenerate={() => void regenerateReadySection()}
              />
            </div>
            <AssistantSectionMaterial
              // Keep the local reveal cursor mounted when a streamed JIT draft is
              // replaced by its final persisted revision. Switching sections
              // still creates a fresh presentation, and reopening a revised
              // section remounts because this branch is absent while it reloads.
              key={active.id}
              userId={userId}
              unitId={unitId}
              goalId={goalId}
              sectionId={active.id}
              sectionTitle={active.title}
              sectionNumber={activeSectionNumber}
              contentRevision={activeContentRevision}
              material={materialForRender!}
              blockOffset={content?.blockOffset ?? 0}
              complexComponentAnchors={active.virtualComponents.map(
                (component) => component.anchor,
              )}
              materialCheckResults={materialCheckResults}
              onVerifiedAnswer={
                assessmentLocked || busy === "generate"
                  ? undefined
                  : localAnswerHandler
              }
              busy={Boolean(busy)}
              forceExpanded={hasGeneratedMiniTest}
              containerRef={assistantSectionRef}
              onContinue={() =>
                active.status === "completed" || active.status === "skipped"
                  ? continueFromCompletedSection()
                  : finish(false)
              }
              onMaterialChange={updateActiveMaterial}
              onMaterialCommitted={reloadActiveSection}
              onRegenerateTopic={(identity) => void regenerateTopic(identity)}
              regeneratingTopicIndex={regeneratingTopicIndex}
              onActiveTopicChange={setSceneTopicIdentity}
              persistedCursor={
                storedAssistantCursor?.contentRevision === activeContentRevision
                  ? storedAssistantCursor.cursor
                  : undefined
              }
              onCursorChange={(cursor) =>
                onSectionCursorChange?.(
                  active.id,
                  activeContentRevision,
                  cursor,
                )
              }
              audioEligible={chatAudioEligible && !readingBody}
              narrationAssets={narrationAssets}
              onNarrationAsset={(asset) =>
                setNarrationAssets((current) => [
                  ...current.filter(
                    (item) => item.contentKey !== asset.contentKey,
                  ),
                  asset,
                ])
              }
            />
          </div>
        ) : (
          <section
            ref={assistantSectionRef}
            className="mx-auto w-full max-w-[48rem] scroll-mt-24 space-y-5"
          >
            <h3 className="sr-only">
              {t("wizard.section.comprehensionCheckHeading", {
                number: activeSectionNumber,
              })}
            </h3>
            <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-2.5 sm:grid-cols-[2.75rem_minmax(0,1fr)] sm:gap-x-3 md:grid-cols-[3.25rem_minmax(0,1fr)] md:gap-x-4">
              <img
                src={assistantAvatarSrc}
                alt=""
                className="size-9 rounded-full object-cover ring-1 ring-[var(--course-content-border)] sm:size-11 md:size-[3.25rem]"
              />
              <p className="self-center text-sm font-semibold text-[var(--course-content-muted)]">
                {assistantName}
              </p>
              <div className="col-span-2 mt-3 min-w-0 sm:col-span-1 sm:col-start-2 sm:mt-2">
                <p className="text-base leading-7 text-[var(--course-content)] sm:text-[1.05rem] sm:leading-8">
                  {t("wizard.section.quizIntroduction")}
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--course-content-muted)]">
                  {t("wizard.section.quizQuestionCount", {
                    count: requiredQuestionIds.length,
                  })}
                </p>
              </div>
            </div>
            <AnchoredLearningMaterial
              unitId={unitId}
              goalId={goalId}
              material={miniTestMaterialForRender!}
              sectionId={active.id}
              continuous
              blockOffset={content?.blockOffset ?? 0}
              deferredSubmit={deferredMiniTest}
              onVerifiedAnswer={
                assessmentLocked || busy === "generate"
                  ? undefined
                  : localAnswerHandler
              }
              materialCheckResults={materialCheckResults}
              onMaterialChange={updateActiveMaterial}
              onMaterialCommitted={reloadActiveSection}
            />
            <div className="sticky bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-10 mx-auto flex w-full max-w-[48rem] flex-col gap-2 rounded-xl border border-[var(--course-content-border)] bg-[var(--bg-50)]/95 p-2 shadow-sm backdrop-blur">
              {error ? (
                <p className="px-1.5 text-xs text-[var(--error-600)]">
                  {error}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                {deferredMiniTest ? (
                  <>
                    <span className="min-w-0 flex-1 truncate px-1.5 text-xs text-[var(--course-content-muted)]">
                      {t("wizard.section.selectedCount", {
                        selected: selectedQuestionCount,
                        total: requiredQuestionIds.length,
                      })}
                    </span>
                    <Button
                      type="button"
                      size="lg"
                      className="min-w-28 rounded-lg px-4"
                      disabled={
                        !allSelected ||
                        submittingMiniTest ||
                        assessmentLocked ||
                        Boolean(busy)
                      }
                      onClick={() => void submitMiniTest()}
                    >
                      {submittingMiniTest ? (
                        <LoaderCircle aria-hidden className="animate-spin" />
                      ) : null}
                      {submittingMiniTest
                        ? t("wizard.section.grading")
                        : t("wizard.section.submitAndGrade")}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate px-1.5 text-xs text-[var(--course-content-muted)]">
                      {busy === "complete"
                        ? t("wizard.section.enteringNext")
                        : t("wizard.section.continueAfterCheck")}
                    </span>
                    <Button
                      type="button"
                      size="lg"
                      className="min-w-24 rounded-lg px-4"
                      disabled={Boolean(busy) || !questionsComplete}
                      onClick={() =>
                        active.status === "completed" ||
                        active.status === "skipped"
                          ? continueFromCompletedSection()
                          : void finish(false)
                      }
                    >
                      {busy === "complete" ? (
                        <LoaderCircle aria-hidden className="animate-spin" />
                      ) : null}
                      {t("wizard.section.continue")}
                      <ChevronRight aria-hidden />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </section>
        )}
        </div>}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      {verifyingContent ? (
        <div className="rounded-xl border border-[var(--brand-200)] bg-[var(--brand-50)] px-4 py-3 text-sm text-[var(--brand-700)]">
          {t("wizard.section.verifyingContent")}
        </div>
      ) : null}
      {isDesktopLocalRuntime() && error ? (
        <PendingTeachingPresentation
          unitId={unitId}
          sectionId={active.id}
          errorKey={error}
          onAccepted={retryGeneration}
        />
      ) : null}
      {error && hasRenderableContent ? (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--error-200)] bg-[var(--error-50)] p-4 text-sm text-[var(--error-600)] sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <SectionPrepareRetryButton
            busy={busy === "generate"}
            preparingLabel={t("wizard.section.preparingCurrentSection")}
            retryLabel={t("wizard.section.prepareAgain")}
            onRetry={retryGeneration}
          />
        </div>
      ) : null}
      <div className="rounded-2xl border border-[var(--border-200)] bg-[var(--bg-50)] p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-[var(--brand-600)]">
              {t("wizard.section.linearProgress", {
                completed: completedCount,
                total: sections.length,
              })}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-[var(--text-800)]">
              <LlmMarkdownInline
                content={
                  active.sectionKind === "mini_test"
                    ? active.title
                    : t("wizard.section.learningSectionTitle", {
                        title: active.title,
                      })
                }
              />
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {active.sectionKind === "content" &&
            active.generationStatus === "ready" &&
            hasRenderableContent ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => void regenerateReadySection()}
              >
                <RotateCcw
                  className={busy === "generate" ? "animate-spin" : undefined}
                  aria-hidden
                />
                {t("wizard.section.regenerateSection")}
              </Button>
            ) : null}
            <div
              className="flex items-center gap-1"
              aria-label={t("wizard.section.learningSections")}
            >
              {sections.map((section, index) => {
                const done =
                  section.status === "completed" ||
                  section.status === "skipped";
                const locked = !priorComplete(index);
                return (
                  <button
                    key={section.id}
                    type="button"
                    disabled={locked}
                    aria-label={t("wizard.section.sectionAriaLabel", {
                      number: index + 1,
                      title: section.title,
                    })}
                    aria-current={index === activeIndex ? "step" : undefined}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full border text-xs font-bold transition-colors",
                      index === activeIndex
                        ? "border-[var(--brand-500)] bg-[var(--brand-500)] text-white"
                        : done
                          ? "border-[var(--success-500)] bg-[var(--success-50)] text-[var(--success-600)]"
                          : "border-[var(--border-200)] bg-[var(--bg-100)] text-[var(--text-500)]",
                      locked && "cursor-not-allowed opacity-45",
                    )}
                    onClick={() => !locked && setActiveIndex(index)}
                  >
                    {done ? (
                      <CheckCircle2 aria-hidden className="size-4" />
                    ) : section.sectionKind === "mini_test" ? (
                      t("wizard.section.quizAbbreviation")
                    ) : (
                      sections
                        .slice(0, index + 1)
                        .filter((item) => item.sectionKind === "content").length
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {active.contentSummary && !isOverview ? (
          <div className="mt-2 text-sm leading-6 text-[var(--text-500)]">
            <LlmMarkdownInline content={active.contentSummary} />
          </div>
        ) : null}
        {active.virtualComponents.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {active.virtualComponents.map((component) => (
              <button
                key={`${active.id}:${component.id}`}
                type="button"
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--brand-200)] bg-[var(--brand-50)] px-3 py-1.5 text-xs font-medium text-[var(--brand-700)]"
                onClick={() =>
                  document.getElementById(component.anchor)?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  })
                }
              >
                <Puzzle aria-hidden className="size-3.5" />
                {component.title}
                <span className="opacity-70">
                  {t("wizard.section.interactive")}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {error && !hasRenderableContent ? (
        <div className="rounded-xl border border-[var(--error-200)] bg-[var(--error-50)] p-4 text-sm text-[var(--error-600)]">
          <p>{error}</p>
          <SectionPrepareRetryButton
            busy={busy === "generate"}
            preparingLabel={t("wizard.section.preparingCurrentSection")}
            retryLabel={t("wizard.section.prepareAgain")}
            onRetry={retryGeneration}
          />
        </div>
      ) : !hasRenderableContent ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border-200)] bg-[var(--bg-100)] p-6 text-center">
          <LoaderCircle
            aria-hidden
            className="size-6 animate-spin text-[var(--brand-600)]"
          />
          <div>
            <p className="font-medium text-[var(--text-800)]">
              {busy === "generate"
                ? active.sectionKind === "mini_test"
                  ? t("wizard.section.generatingQuizFromPrevious")
                  : active.contentKind === "formal_derivation"
                    ? t("wizard.section.preparingDerivation")
                    : t("wizard.section.preparingCurrentSection")
                : t("wizard.section.loadingContent")}
            </p>
            <p className="mt-1 text-xs text-[var(--text-400)]">
              {active.sectionKind === "mini_test"
                ? t("wizard.section.quizCoverageHint")
                : t("wizard.section.quizGenerationHint")}
            </p>
          </div>
        </div>
      ) : teachingDerivationForRender ? (
        <div ref={bodyRef} className="min-h-[28rem]">
          {busy === "generate" ? (
            <p className="mb-2 text-xs text-[var(--text-400)]">
              {t("wizard.section.continuingDerivation")}
            </p>
          ) : null}
          <TeachingDerivationPlayer
            key={active.id}
            document={teachingDerivationForRender}
            presentationContext={{
              unitId,
              sectionId: active.id,
              revision: activeContentRevision,
              onUpdated: reloadActiveSection,
            }}
            derived={content?.teachingDerivationDerived ?? null}
            assistantName={assistantName}
            assistantAvatarSrc={assistantAvatarSrc}
            busy={busy === "load" || busy === "complete"}
            generating={busy === "generate"}
            onContinue={() =>
              active.status === "completed" || active.status === "skipped"
                ? continueFromCompletedSection()
                : void finish(false)
            }
            persistedCursor={
              storedAssistantCursor?.contentRevision === activeContentRevision
                ? storedAssistantCursor.cursor
                : undefined
            }
            onCursorChange={(cursor) =>
              onSectionCursorChange?.(active.id, activeContentRevision, cursor)
            }
          />
        </div>
      ) : derivationForRender ? (
        <div ref={bodyRef} className="min-h-[28rem]">
          {busy === "generate" ? (
            <p className="mb-2 text-xs text-[var(--text-400)]">
              {t("wizard.section.continuingDerivation")}
            </p>
          ) : null}
          <FormalDerivationSection
            key={active.id}
            document={derivationForRender}
            assistantName={assistantName}
            assistantAvatarSrc={assistantAvatarSrc}
            busy={busy === "load" || busy === "complete"}
            generating={busy === "generate"}
            onContinue={() =>
              active.status === "completed" || active.status === "skipped"
                ? continueFromCompletedSection()
                : void finish(false)
            }
            persistedCursor={
              storedAssistantCursor?.contentRevision === activeContentRevision
                ? storedAssistantCursor.cursor
                : undefined
            }
            onCursorChange={(cursor) =>
              onSectionCursorChange?.(active.id, activeContentRevision, cursor)
            }
          />
        </div>
      ) : (
        <div ref={bodyRef} className="space-y-3">
          <div aria-busy={busy === "generate"}>
            <AnchoredLearningMaterial
              unitId={unitId}
              goalId={goalId}
              material={materialForRender!}
              sectionId={active.id}
              continuous
              blockOffset={content?.blockOffset ?? 0}
              complexComponentAnchors={active.virtualComponents.map(
                (component) => component.anchor,
              )}
              deferredSubmit={deferredMiniTest}
              onVerifiedAnswer={
                assessmentLocked || busy === "generate"
                  ? undefined
                  : localAnswerHandler
              }
              materialCheckResults={materialCheckResults}
              onMaterialChange={updateActiveMaterial}
              onMaterialCommitted={reloadActiveSection}
              onRegenerateTopic={(identity) => void regenerateTopic(identity)}
              regeneratingTopicIndex={regeneratingTopicIndex}
            />
          </div>
        </div>
      )}

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-200)] bg-[color:var(--bg-50)]/95 p-3 shadow-lg backdrop-blur">
        <Button
          variant="outline"
          disabled={activeIndex === 0 || Boolean(busy) || submittingMiniTest}
          onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
        >
          <ChevronLeft aria-hidden /> {t("wizard.section.previous")}
        </Button>
        <div className="flex items-center gap-2">
          {busy === "generate" ? (
            <Button
              variant="outline"
              disabled={stopping}
              onClick={() => void stopGeneration()}
            >
              {stopping ? (
                <LoaderCircle aria-hidden className="animate-spin" />
              ) : (
                <Square aria-hidden />
              )}
              {stopping
                ? t("wizard.section.stopping")
                : t("wizard.section.stopGeneration")}
            </Button>
          ) : null}
          {deferredMiniTest && requiredQuestionIds.length > 0 ? (
            <span className="text-xs text-[var(--text-500)]">
              {t("wizard.section.selectedCount", {
                selected: selectedQuestionCount,
                total: requiredQuestionIds.length,
              })}
            </span>
          ) : null}
          {deferredMiniTest ? (
            <Button
              disabled={
                !allSelected ||
                submittingMiniTest ||
                assessmentLocked ||
                Boolean(busy)
              }
              onClick={() => void submitMiniTest()}
            >
              {submittingMiniTest ? (
                <LoaderCircle aria-hidden className="animate-spin" />
              ) : null}
              {submittingMiniTest
                ? t("wizard.section.grading")
                : t("wizard.section.submitAndGrade")}
            </Button>
          ) : null}
          {!deferredMiniTest &&
          active.status !== "completed" &&
          active.status !== "skipped" &&
          requiredQuestionIds.length > 0 ? (
            <span className="text-xs text-[var(--text-500)]">
              {t("wizard.section.quizProgress", {
                answered: answeredQuestionCount,
                total: requiredQuestionIds.length,
              })}
            </span>
          ) : null}
          {active.recommendSkip &&
          active.status !== "completed" &&
          active.status !== "skipped" ? (
            <Button
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={() => void finish(true)}
            >
              <Sparkles aria-hidden /> {t("wizard.section.skipSuggested")}
            </Button>
          ) : null}
          {active.status === "completed" || active.status === "skipped" ? (
            activeIndex >= sections.length - 1 ? (
              <Button
                disabled={Boolean(busy)}
                onClick={() => onAllSectionsCompleted?.()}
              >
                {t("wizard.section.enterGuidingQuestions")}{" "}
                <ChevronRight aria-hidden />
              </Button>
            ) : (
              <Button
                onClick={() =>
                  setActiveIndex((index) =>
                    Math.min(sections.length - 1, index + 1),
                  )
                }
              >
                {t("wizard.section.next")} <ChevronRight aria-hidden />
              </Button>
            )
          ) : (
            <Button
              disabled={
                !hasRenderableContent ||
                Boolean(busy) ||
                submittingMiniTest ||
                !questionsComplete ||
                Boolean(derivationForRender || teachingDerivationForRender)
              }
              onClick={() => void finish(false)}
            >
              {busy === "complete" ? (
                <LoaderCircle aria-hidden className="animate-spin" />
              ) : (
                <Circle aria-hidden />
              )}
              {finishActionLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
