import { translateCurrent } from "@xue-learn/core/i18n";
import { useMainlineReadingPosition } from "@/features/learning-mainline/use-reading-position";
import {
  captureReadingPosition,
  rememberLearningPosition,
  activeLearningVisitId,
} from "@/features/learning-trajectory/navigation";
import { useReadingLearningReturn } from "@/features/learning-trajectory/use-reading-return";
import { SectionSupplements } from "@/features/learning-trajectory/section-supplements";
("use client");

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  anchorId,
  computeBlockKey,
  type MaterialAnchor,
} from "@xue-learn/core/shared/domain/material-anchor";
import {
  buildTextHighlightMap,
  type OpenFollowUpMeta,
} from "@xue-learn/core/shared/domain/material-highlight";
import { shouldCollapseActiveFollowUpHighlight } from "@/shared/domain/follow-up-panel-state";
import type {
  InteractiveBlock,
  LearningMaterialContent,
} from "@xue-learn/core/schemas";
import type { ContentSource } from "@xue-learn/core/shared/types/content-sources";
import { scrollFollowUpAnchorIntoView } from "@/shared/dom/follow-up-anchor-rect";
import { useAssistant } from "@/components/agent/assistant-provider";
import { useTeachingPersonas } from "@/hooks/api/use-teaching-personas";
import { teachingPersonaAvatarSrc } from "@/shared/teaching-persona-avatar";
import { localizeTeachingPersonaName } from "@/shared/teaching-persona-i18n";
import { useT } from "@xue-learn/core/i18n";
import { supportsMaterialFollowUps } from "@xue-learn/core/client-runtime";
import { ContentSourcesPanel } from "./content-sources-panel.tsx";
import { useMaterialFollowUps } from "@/hooks/use-material-follow-ups";
import { subscribeToUnitMaterialCommitted } from "@/shared/dom/unit-material-committed";
import { InteractiveMaterialBody } from "./interactive-material-body.tsx";
import type {
  AssistantFeedPresentation,
  MaterialCheckResult,
  VerifiedMaterialAnswerHandler,
} from "./interactive-material-body.tsx";
import { MaterialSlideDeck } from "./material-slide-deck.tsx";

function localizeSectionAnchor(
  material: LearningMaterialContent,
  blockOffset: number,
  sectionId: string | undefined,
  anchor: MaterialAnchor,
): MaterialAnchor | null {
  if (anchor.reading) return null;
  if (anchor.sectionId && anchor.sectionId !== sectionId) return null;
  if (
    !anchor.sectionId &&
    sectionId !== "legacy-material" &&
    anchor.scope !== "block"
  ) {
    return null;
  }

  if (
    blockOffset === 0 ||
    anchor.scope !== "block" ||
    anchor.blockIndex == null
  ) {
    return anchor;
  }

  const blockIndex = anchor.blockIndex - blockOffset;
  if (blockIndex < 0 || blockIndex >= material.blocks.length) return null;

  return {
    ...anchor,
    blockIndex,
    // Fingerprints include the unit-level index. Let the local section first
    // resolve by its local index/type, then relocate an exact quote if needed.
    blockKey: undefined,
    highlightKey: anchor.highlightKey?.replace(
      /^block:\d+/,
      `block:${blockIndex}`,
    ),
  };
}

/** Learning material with a non-reflowing, responsive follow-up workspace. */
export function AnchoredLearningMaterial({
  unitId,
  sectionId,
  goalId,
  material,
  contextSources = [],
  compact = false,
  onMaterialChange,
  onMaterialCommitted,
  onSlidesCompleted,
  initialPresentation,
  onPresentationActivity,
  tocFooter,
  onVerifiedAnswer,
  materialCheckResults = [],
  continuous = false,
  blockOffset = 0,
  complexComponentAnchors = [],
  deferredSubmit = false,
  assistantFeed,
  revealAnswers = false,
  onRegenerateTopic,
  regeneratingTopicIndex,
}: {
  unitId: string;
  /** Stable owner of this material; legacy and micro courses use one synthetic section. */
  sectionId: string;
  /** Lets the follow-up UI display the same teacher selected for this goal. */
  goalId?: string;
  material: LearningMaterialContent;
  contextSources?: ContentSource[];
  compact?: boolean;
  onMaterialChange?: (material: LearningMaterialContent) => void;
  onMaterialCommitted?: () => void | Promise<void>;
  onSlidesCompleted?: () => void;
  initialPresentation?: {
    slideIndex: number;
    hasCompletedSlides: boolean;
  } | null;
  onPresentationActivity?: (state: {
    slideIndex: number;
    hasCompletedSlides: boolean;
  }) => void;
  tocFooter?: ReactNode;
  onVerifiedAnswer?: VerifiedMaterialAnswerHandler;
  materialCheckResults?: MaterialCheckResult[];
  /** Scrolling course body with the same follow-up workspace as slide mode. */
  continuous?: boolean;
  /** Unit-level offset used by section-scoped blocks. */
  blockOffset?: number;
  complexComponentAnchors?: string[];
  deferredSubmit?: boolean;
  assistantFeed?: Omit<AssistantFeedPresentation, "persona">;
  revealAnswers?: boolean;
  onRegenerateTopic?: (input: { topicId?: string; topicIndex: number }) => void;
  regeneratingTopicIndex?: number | null;
}) {
  useReadingLearningReturn(unitId, sectionId, material);
  useMainlineReadingPosition(unitId, sectionId, material);
  const followUpsEnabled = supportsMaterialFollowUps();
  const fu = useMaterialFollowUps(unitId, {
    onMaterialChange,
    onMaterialCommitted,
    enabled: followUpsEnabled,
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpenedThreadRef = useRef<string | null>(null);
  const {
    open: assistantOpen,
    openUnitFollowUp,
    closeUnitFollowUp,
  } = useAssistant();
  const followUpOwnerId = useId();
  const [inlineSelection, setInlineSelection] = useState<{
    anchor: MaterialAnchor;
    text: string;
    nonce: number;
  }>();
  const inlineMode = Boolean(assistantFeed);
  const teachingPersonas = useTeachingPersonas({
    goalId,
    enabled: followUpsEnabled,
  });
  const t = useT();
  const assistantName = localizeTeachingPersonaName(
    teachingPersonas.data?.current,
    t,
  );
  const assistantAvatarSrc = teachingPersonaAvatarSrc(
    teachingPersonas.data?.current.avatarCode ?? "xiaohui_female",
  );
  const [locateNonce, setLocateNonce] = useState(0);
  const requestedFollowUpId = searchParams.get("followUp");
  const materialRef = useRef(material);
  materialRef.current = material;

  useEffect(() => {
    return subscribeToUnitMaterialCommitted((event) => {
      if (event.unitId !== unitId) return;
      if (onMaterialChange) {
        onMaterialChange(event.material);
        return;
      }
      void onMaterialCommitted?.();
    });
  }, [onMaterialChange, onMaterialCommitted, unitId]);

  // Closing the companion via X only collapses mode; keep panelOpen in sync so a
  // re-click on the same highlight opens again instead of toggling closed.
  useEffect(() => {
    if (!assistantOpen && fu.panelOpen) {
      fu.hidePanel();
    }
  }, [assistantOpen, fu.hidePanel, fu.panelOpen]);

  useEffect(() => {
    if (
      !requestedFollowUpId ||
      fu.loading ||
      autoOpenedThreadRef.current === requestedFollowUpId
    ) {
      return;
    }
    const thread = fu.threads.find((item) => item.id === requestedFollowUpId);
    if (!thread || thread.anchor.reading) return;

    autoOpenedThreadRef.current = requestedFollowUpId;
    fu.openAnchor(thread.anchor, thread.id);
    openUnitFollowUp(unitId, followUpOwnerId, {
      goalId: goalId ?? "",
      anchor: thread.anchor,
      threadId: thread.id,
    });
    setLocateNonce((value) => value + 1);
    window.requestAnimationFrame(() => {
      scrollFollowUpAnchorIntoView(
        thread.anchor,
        anchorId(thread.anchor),
        material,
      );
    });

    const next = new URLSearchParams(searchParams);
    next.delete("followUp");
    setSearchParams(next, { replace: true });
  }, [
    fu.loading,
    fu.openAnchor,
    fu.threads,
    material,
    followUpOwnerId,
    openUnitFollowUp,
    requestedFollowUpId,
    searchParams,
    setSearchParams,
    unitId,
  ]);

  useEffect(
    () => () => closeUnitFollowUp(followUpOwnerId),
    [closeUnitFollowUp, followUpOwnerId],
  );
  const activeAnchorId = fu.activeAnchor ? anchorId(fu.activeAnchor) : null;

  const textHighlights = useMemo(() => {
    const entries: {
      anchor: MaterialAnchor;
      threadId?: string;
      aid?: string;
    }[] = fu.threads.flatMap((thread) => {
      const anchor = localizeSectionAnchor(
        material,
        blockOffset,
        sectionId,
        thread.anchor,
      );
      return anchor
        ? [{ anchor, threadId: thread.id, aid: anchorId(thread.anchor) }]
        : [];
    });
    if (fu.activeAnchor) {
      const anchor = localizeSectionAnchor(
        material,
        blockOffset,
        sectionId,
        fu.activeAnchor,
      );
      if (anchor) {
        entries.push({
          anchor,
          threadId: fu.activeThreadId ?? undefined,
          aid: anchorId(fu.activeAnchor),
        });
      }
    }
    return buildTextHighlightMap(material, entries, activeAnchorId);
  }, [
    material,
    blockOffset,
    sectionId,
    fu.threads,
    fu.activeAnchor,
    fu.activeThreadId,
    activeAnchorId,
  ]);

  const blockThreadIds = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of fu.threads) {
      if (t.anchor.reading) continue;
      if (t.anchor.scope !== "block" || t.anchor.blockIndex == null) continue;
      if (t.anchor.subPath?.startsWith("check")) {
        const localIndex = t.anchor.blockIndex - blockOffset;
        if (localIndex >= 0 && localIndex < material.blocks.length) {
          map.set(localIndex, t.id);
        }
      }
    }
    return map;
  }, [blockOffset, fu.threads, material.blocks.length]);

  const toUnitAnchor = useCallback(
    (anchor: MaterialAnchor): MaterialAnchor => {
      const scopedAnchor = sectionId ? { ...anchor, sectionId } : anchor;
      if (anchor.scope !== "block" || blockOffset === 0) return scopedAnchor;
      const localIndex = anchor.blockIndex ?? 0;
      const globalIndex = localIndex + blockOffset;
      const block = material.blocks[localIndex];
      return {
        ...scopedAnchor,
        blockIndex: globalIndex,
        blockKey: block ? computeBlockKey(block, globalIndex) : anchor.blockKey,
        highlightKey: anchor.highlightKey?.replace(
          /^block:\d+/,
          `block:${globalIndex}`,
        ),
      };
    },
    [blockOffset, material.blocks, sectionId],
  );

  const toLocalAnchor = useCallback(
    (anchor: MaterialAnchor): MaterialAnchor => {
      if (anchor.scope !== "block" || !blockOffset) return anchor;
      const blockIndex = (anchor.blockIndex ?? 0) - blockOffset;
      return {
        ...anchor,
        blockIndex,
        blockKey: anchor.blockKey?.replace(
          /^([^:]+):\d+:/,
          `$1:${blockIndex}:`,
        ),
        highlightKey: anchor.highlightKey?.replace(
          /^block:\d+/,
          `block:${blockIndex}`,
        ),
      };
    },
    [blockOffset],
  );

  const openFollowUp = useCallback(
    (anchor: MaterialAnchor, meta?: OpenFollowUpMeta) => {
      if (inlineMode) {
        setInlineSelection({
          anchor,
          text: anchor.selectedText?.trim() || "",
          nonce: Date.now(),
        });
        return;
      }
      if (fu.sending) {
        fu.setError(
          translateCurrent(
            "desktop.copy.anAnswerIsBeingGeneratedWaitForItToFinish",
          ),
        );
        openUnitFollowUp(unitId, followUpOwnerId);
        return;
      }

      const learningPosition = captureReadingPosition(
        unitId,
        sectionId,
        material,
        anchor,
      );
      rememberLearningPosition(learningPosition);
      const unitAnchor = toUnitAnchor(anchor);
      const existing = meta?.newThread
        ? undefined
        : fu.threads.find((t) => anchorId(t.anchor) === anchorId(unitAnchor));
      const threadId = meta?.threadId ?? existing?.id;
      const autoMessage = meta?.autoMessage?.trim();

      if (autoMessage && !existing?.messages?.length) {
        openUnitFollowUp(unitId, followUpOwnerId, {
          goalId: goalId ?? "",
          anchor: unitAnchor,
          learningPosition,
          activeVisitId: activeLearningVisitId(),
          threadId,
          initialMessage: autoMessage,
        });
        return;
      }

      fu.openAnchor(unitAnchor, threadId);
      openUnitFollowUp(unitId, followUpOwnerId, {
        goalId: goalId ?? "",
        anchor: unitAnchor,
        learningPosition,
        activeVisitId: activeLearningVisitId(),
        threadId,
      });
    },
    [
      followUpOwnerId,
      inlineMode,
      fu,
      goalId,
      openUnitFollowUp,
      toUnitAnchor,
      toLocalAnchor,
      unitId,
      sectionId,
      material,
    ],
  );

  const openFromHighlight = useCallback(
    (aid: string, threadId?: string) => {
      if (inlineMode) {
        const thread = fu.threads.find((item) =>
          threadId ? item.id === threadId : anchorId(item.anchor) === aid,
        );
        if (thread)
          setInlineSelection({
            anchor: toLocalAnchor(thread.anchor),
            text: thread.anchor.selectedText ?? "",
            nonce: Date.now(),
          });
        return;
      }
      if (fu.activeAnchor && anchorId(fu.activeAnchor) === aid) {
        if (
          shouldCollapseActiveFollowUpHighlight({
            panelOpen: fu.panelOpen,
            assistantOpen,
          })
        ) {
          fu.hidePanel();
          closeUnitFollowUp(followUpOwnerId);
        } else {
          fu.showPanel();
          openUnitFollowUp(unitId, followUpOwnerId);
        }
        return;
      }

      const thread =
        (threadId ? fu.threads.find((t) => t.id === threadId) : undefined) ??
        fu.threads.find((t) => anchorId(t.anchor) === aid);
      const anchor =
        thread?.anchor ??
        (fu.activeAnchor && anchorId(fu.activeAnchor) === aid
          ? fu.activeAnchor
          : null);
      if (!anchor) return;

      openFollowUp(anchor, {
        threadId: threadId ?? thread?.id,
      });
      window.requestAnimationFrame(() => {
        scrollFollowUpAnchorIntoView(anchor, aid, material);
      });
    },
    [
      assistantOpen,
      inlineMode,
      closeUnitFollowUp,
      followUpOwnerId,
      fu,
      material,
      openFollowUp,
      openUnitFollowUp,
      toLocalAnchor,
      unitId,
    ],
  );

  const followUpHandlers = useMemo(
    () =>
      followUpsEnabled
        ? {
            textHighlights,
            activeAnchorId,
            blockThreadIds,
            inlineChat: {
              discussions: (() => {
                const records = fu.threads
                  .filter(
                    (thread) =>
                      !thread.anchor.reading &&
                      thread.anchor.sectionId === sectionId,
                  )
                  .map((thread) => ({
                    ...thread,
                    anchor: toLocalAnchor(thread.anchor),
                  }));
                if (
                  !fu.activeAnchor ||
                  fu.activeAnchor.sectionId !== sectionId ||
                  !fu.displayMessages.length
                )
                  return records;
                const activeLocalAnchor = toLocalAnchor(fu.activeAnchor);
                const id = anchorId(activeLocalAnchor);
                const existing = records.find(
                  (thread) => anchorId(thread.anchor) === id,
                );
                return [
                  ...records.filter((thread) => thread !== existing),
                  {
                    id: existing?.id ?? anchorId(fu.activeAnchor),
                    anchor: activeLocalAnchor,
                    messages: fu.displayMessages,
                  },
                ].sort((a, b) =>
                  (a.messages[0]?.createdAt ?? "").localeCompare(
                    b.messages[0]?.createdAt ?? "",
                  ),
                );
              })(),
              activeDiscussionId: fu.activeAnchor
                ? (fu.threads.find(
                    (thread) =>
                      anchorId(thread.anchor) === anchorId(fu.activeAnchor!),
                  )?.id ?? anchorId(fu.activeAnchor))
                : undefined,
              sending: fu.sending,
              error: fu.error,
              stop: fu.stop,
              selection: inlineSelection,
              clearSelection: () => setInlineSelection(undefined),
              messagesFor: (
                anchor: MaterialAnchor,
                aliases: MaterialAnchor[] = [],
              ) => {
                const targets = [anchor, ...aliases].map((candidate) =>
                  anchorId(toUnitAnchor(candidate)),
                );
                if (
                  fu.activeAnchor &&
                  targets.includes(anchorId(fu.activeAnchor))
                ) {
                  return fu.displayMessages;
                }
                return (
                  fu.threads.find((thread) =>
                    targets.includes(anchorId(thread.anchor)),
                  )?.messages ?? []
                );
              },
              send: async (anchor: MaterialAnchor, message: string) => {
                if (fu.sending) return false;
                const position = captureReadingPosition(
                  unitId,
                  sectionId,
                  material,
                  inlineSelection?.anchor ?? anchor,
                );
                rememberLearningPosition(position);
                const requestedAnchor = inlineSelection?.anchor ?? anchor;
                const targets = [requestedAnchor].map((candidate) =>
                  anchorId(toUnitAnchor(candidate)),
                );
                const existing = fu.threads.find((thread) =>
                  targets.includes(anchorId(thread.anchor)),
                );
                const target =
                  existing?.anchor ?? toUnitAnchor(requestedAnchor);
                const sent = await fu.openAnchorAndSend(
                  target,
                  message,
                  existing?.id,
                  {
                    quotedText: inlineSelection?.text.slice(0, 240),
                    learningPosition: position,
                    activeVisitId: activeLearningVisitId(),
                  },
                );
                if (sent)
                  setInlineSelection((current) =>
                    current?.nonce === inlineSelection?.nonce && current
                      ? { ...current, text: "" }
                      : current,
                  );
                return sent;
              },
            },
            onOpenFollowUp: openFollowUp,
            onHighlightClick: openFromHighlight,
          }
        : undefined,
    [
      textHighlights,
      activeAnchorId,
      blockThreadIds,
      followUpsEnabled,
      openFollowUp,
      openFromHighlight,
      fu,
      toUnitAnchor,
      toLocalAnchor,
      inlineSelection,
      unitId,
      sectionId,
      material,
    ],
  );

  const illustrationRegen = {
    unitId,
    blockOffset,
    onBlockRegenerated: (blockIndex: number, replacement: InteractiveBlock) => {
      const currentMaterial = materialRef.current;
      const updatedMaterial = {
        ...currentMaterial,
        blocks: currentMaterial.blocks.map((block, index) =>
          index === blockIndex ? replacement : block,
        ),
      };
      materialRef.current = updatedMaterial;
      onMaterialChange?.(updatedMaterial);
      void onMaterialCommitted?.();
    },
    onBlockDeleted: (blockIndex: number) => {
      const currentMaterial = materialRef.current;
      const updatedMaterial = {
        ...currentMaterial,
        blocks: currentMaterial.blocks.filter(
          (_, index) => index !== blockIndex,
        ),
      };
      materialRef.current = updatedMaterial;
      onMaterialChange?.(updatedMaterial);
      void onMaterialCommitted?.();
    },
    onIllustrationRegenerated: (
      blockIndex: number,
      patch: { imageUrl: string; imageId: string },
      figureIndex?: number,
    ) => {
      const currentMaterial = materialRef.current;
      const updatedMaterial = {
        ...currentMaterial,
        blocks: currentMaterial.blocks.map((block, index) =>
          index === blockIndex && figureIndex != null && block.type === "stage"
            ? {
                ...block,
                figures: block.figures.map((figure, index) =>
                  index === figureIndex && figure.type === "illustration"
                    ? { ...figure, ...patch }
                    : figure,
                ) as typeof block.figures,
              }
            : index === blockIndex && block.type === "illustration"
              ? { ...block, imageUrl: patch.imageUrl, imageId: patch.imageId }
              : block,
        ),
      };
      materialRef.current = updatedMaterial;
      onMaterialChange?.(updatedMaterial);
      void onMaterialCommitted?.();
    },
  };

  return (
    <div
      className="relative min-w-0 max-w-full"
      data-learning-section={sectionId}
    >
      <SectionSupplements unitId={unitId} sectionId={sectionId} />
      {contextSources.length > 0 && (
        <ContentSourcesPanel
          sources={contextSources}
          compact={compact}
          showCitationHint
          className="mb-3"
        />
      )}
      {compact ? (
        <InteractiveMaterialBody
          material={material}
          contextSources={contextSources}
          compact
          revealAnswers
          followUp={followUpHandlers}
          illustrationRegen={illustrationRegen}
          onRegenerateTopic={onRegenerateTopic}
          regeneratingTopicIndex={regeneratingTopicIndex}
        />
      ) : continuous ? (
        <InteractiveMaterialBody
          material={material}
          contextSources={contextSources}
          followUp={followUpHandlers}
          illustrationRegen={illustrationRegen}
          onVerifiedAnswer={onVerifiedAnswer}
          materialCheckResults={materialCheckResults}
          complexComponentAnchors={complexComponentAnchors}
          deferredSubmit={deferredSubmit}
          revealAnswers={revealAnswers}
          assistantFeed={
            assistantFeed
              ? {
                  ...assistantFeed,
                  persona: {
                    name: assistantName,
                    avatarSrc: assistantAvatarSrc,
                  },
                }
              : undefined
          }
          onRegenerateTopic={onRegenerateTopic}
          regeneratingTopicIndex={regeneratingTopicIndex}
        />
      ) : (
        <MaterialSlideDeck
          unitId={unitId}
          material={material}
          contextSources={contextSources}
          followUp={followUpHandlers}
          illustrationRegen={illustrationRegen}
          revealAnchor={fu.activeAnchor}
          revealAnchorNonce={locateNonce}
          onSlidesCompleted={onSlidesCompleted}
          initialPresentation={initialPresentation}
          onPresentationActivity={onPresentationActivity}
          tocFooter={tocFooter}
          onVerifiedAnswer={onVerifiedAnswer}
          materialCheckResults={materialCheckResults}
        />
      )}
    </div>
  );
}
