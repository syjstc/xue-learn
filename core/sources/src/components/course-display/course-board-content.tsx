import { MusicDisplay } from "./music-display.js";
import { MusicTeachingDisplay } from "./music-teaching-display.js";
import { readMaterialMusic, readMusicTeaching } from "../../../libs/domain/src/index.js";
import { VisualBoard } from "./visual-board.js";
import { TeachingDisplay } from "./teaching-display.js";
import { readMaterialTeaching } from "../../../libs/domain/src/index.js";
import type { MaterialTeachingCueInterval } from "../../../libs/domain/src/index.js";
import { readMaterialVisual } from "../../../libs/domain/src/index.js";
import { PresentationStage } from "./presentation-stage.js";
import { isMaterialPresentation } from "../../../libs/domain/src/index.js";
import { ArrowRight, Lightbulb, MessageCircle } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../../shared/utils.js";
import { courseTextBoard } from "../../shared/domain/course-text-board.js";
import { CourseTextBoard } from "./course-text-board.js";
import { CourseCallout, type CourseCalloutVariant } from "./course-callout.js";
import { CourseCalloutBody } from "./course-callout-body.js";
import { supportsCourseCardBuild, courseCardRevealedIndexes } from "../../shared/domain/course-card-build.js";
import { ProseMarkdown } from "../markdown/prose-markdown.js";
import { useT } from "../../shared/i18n/index.js";
import { legacyCompareDisplay, classroomStageTargetId, classroomCompareTargetId, classroomFigureScopedTargetId, blockFigureId, isMaterialStageLayout, layoutSlots, materialStageFocusIndexes, interpolateMaterialStageLayout, resolveMaterialStageLayout, materialStagePicturePlacement, materialStageItemStyle, materialStageCanvasStyle, materialStagePlanStyle, materialCueNodeLit, type CourseDisplayBlock, type MaterialStageLayout } from "../../../libs/domain/src/index.js";
import type { CourseDisplayScene } from "../../../libs/domain/src/index.js";
import {
  CourseMediaScene,
  StageCodeBoard,
  staticIllustrationUrl,
  staticSvgMarkup,
} from "./course-board-media.js";
import { classroomContentRect } from "./classroom-geometry.js";
import {
  classroomBoardDisplayText,
  classroomCompareSlotLines,
  classroomStageTypeStyle,
  classroomStageTypography,
  CLASSROOM_STAGE_TYPE_BASE,
} from "./classroom-stage-typography.js";

type BoardOptions = {
  calloutPresentation?: "film";
  teachingTimeline?: { intervals: readonly MaterialTeachingCueInterval[]; tick: number };
  revealedTargetIds?: readonly string[];
  previousRevealedTargetIds?: readonly string[];
  animate?: boolean;
  mode?: "classroom" | "chat";
  contentSize?: { width: number; height: number };
  renderCode?: (
    block: CourseDisplayBlock,
    options?: { contentSized: boolean },
  ) => ReactNode;
  renderMedia?: (block: CourseDisplayBlock) => ReactNode;
};
const BoardOptionsContext = createContext<BoardOptions>({});

function TeachingUnavailable() {
  const t = useT();
  return <p role="status">{t("teaching.unavailable")}</p>;
}

function MusicUnavailable() {
  const t = useT();
  return <p role="status">{t("music.unavailable")}</p>;
}

/** Music owns its terminal rendering; never send it back to the reading fallback. */
function MusicFigure({
  block,
  activeTargetIds,
}: {
  block: CourseDisplayBlock;
  activeTargetIds: readonly string[];
}) {
  const options = useContext(BoardOptionsContext);
  const teaching = readMusicTeaching(block);
  if (teaching)
    return (
      <MusicTeachingDisplay
        block={teaching}
        activeTargetIds={activeTargetIds}
        interactive={options.mode === "chat"}
      />
    );
  const music = readMaterialMusic(block);
  if (music)
    return <MusicDisplay block={music} activeTargetIds={activeTargetIds} />;
  return <MusicUnavailable />;
}

export function CourseBoardContent(
  props: BoardOptions & {
    scene: Pick<CourseDisplayScene, "templateId" | "slots" | "title">;
    mediaBlock?: CourseDisplayBlock;
    activeTargetIds?: readonly string[];
    previousActiveTargetIds?: readonly string[];
    clocked?: boolean;
    beatEnter?: number;
  },
) {
  return (
    <BoardOptionsContext.Provider
      value={{
        mode: props.mode,
        calloutPresentation: props.calloutPresentation,
        animate: props.animate,
        contentSize: props.contentSize,
        renderCode: props.renderCode,
        renderMedia: props.renderMedia,
        revealedTargetIds: props.revealedTargetIds,
        previousRevealedTargetIds: props.previousRevealedTargetIds,
        teachingTimeline: props.teachingTimeline,
      }}
    >
      <ContentScene {...props} />
    </BoardOptionsContext.Provider>
  );
}

/** Shared board artwork. Callers supply time; this layer never starts playback. */
const CLASSROOM_CALLOUT_LABELS: Readonly<Record<string, string>> = {
  tip: "提示",
  warning: "注意",
  definition: "定义",
  example: "示例",
};

/** Inline classroom copy: keep `$...$` for HTML KaTeX. */
export function ClassroomInlineCopy({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <ProseMarkdown
      content={classroomBoardDisplayText(content)}
      variant="inline"
      className={className}
    />
  );
}

function ClassroomBoardCopy({ content }: { content: string }) {
  return <ClassroomInlineCopy content={content} className="lp-board-copy" />;
}

type BoardCompareSide = { label?: string; points?: readonly string[] };
function snapshotCompareSides(
  block: CourseDisplayBlock,
): BoardCompareSide[] {
  const sides =
    Array.isArray(block.sides) && block.sides.length >= 2
      ? block.sides
      : [block.left, block.right];
  return sides.filter(
    (side): side is BoardCompareSide => !!side && typeof side === "object",
  );
}

/** Historical compare data delegates to the ordinary subview renderer. */
function LegacyCompareStage({
  block,
  activeTargetIds,
  previousActiveTargetIds = [],
  clocked,
  beatEnter,
}: {
  block: CourseDisplayBlock;
  activeTargetIds: readonly string[];
  previousActiveTargetIds?: readonly string[];
  clocked?: boolean;
  beatEnter?: number;
}) {
  const projection = legacyCompareDisplay(block);
  return (
    <ComposedStageScene
      mediaBlock={
        projection.display as unknown as CourseDisplayBlock
      }
      activeTargetIds={projection.targets(activeTargetIds)}
      previousActiveTargetIds={projection.targets(previousActiveTargetIds)}
      clocked={clocked}
      beatEnter={beatEnter}
    />
  );
}

function StageFigurePane({
  figure,
  targetId,
  activeTargetIds,
  previousActiveTargetIds = [],
  clocked = false,
  beatEnter,
  focused = false,
  figureSize,
  contentSized = false,
}: {
  figure: CourseDisplayBlock;
  targetId: string;
  activeTargetIds: readonly string[];
  previousActiveTargetIds?: readonly string[];
  clocked?: boolean;
  beatEnter?: number;
  focused?: boolean;
  figureSize?: { width: number; height: number };
  contentSized?: boolean;
}) {
  const options = useContext(BoardOptionsContext);
  const visual = readMaterialVisual(figure);
  const teaching = readMaterialTeaching(figure);
  const svgMarkup = staticSvgMarkup(figure);
  const imageUrl = svgMarkup ? null : staticIllustrationUrl(figure);
  const isCallout = figure.type === "callout";
  const figureVariant =
    typeof figure.variant === "string" ? figure.variant : undefined;
  const figureId = blockFigureId(figure);
  const lit =
    materialCueNodeLit(activeTargetIds, targetId) ||
    (figure.type === "code" &&
      (materialCueNodeLit(activeTargetIds, "code", figureId) ||
        activeTargetIds.some(
          (id) =>
            id.startsWith("code:") ||
            (figureId
              ? id.startsWith(
                  `${classroomFigureScopedTargetId(figureId, "code")}:`,
                )
              : false),
        ))) ||
    (figure.type === "compare" &&
      (materialCueNodeLit(activeTargetIds, "compare", figureId) ||
        materialCueNodeLit(
          activeTargetIds,
          classroomCompareTargetId(0),
          figureId,
        ) ||
        materialCueNodeLit(
          activeTargetIds,
          classroomCompareTargetId(1),
          figureId,
        )));
  const compareSides =
    figure.type === "compare" ? snapshotCompareSides(figure) : [];
  return (
    <div
      className="lp-composed-figure"
      data-lp-target={targetId}
      data-lp-figure-type={figure.type}
      data-lp-figure-variant={figureVariant}
      data-lp-lit={lit ? "true" : undefined}
      data-lp-focused={focused ? "true" : undefined}
    >
      {figure.type === "teaching" ? (
        teaching ? <TeachingDisplay block={teaching} activeTargetIds={activeTargetIds}
          previousActiveTargetIds={previousActiveTargetIds} revealedTargetIds={options.revealedTargetIds}
          progress={beatEnter} reading={options.mode === "chat"} animate={options.animate}
          timeline={options.teachingTimeline}/> : <TeachingUnavailable/>
      ) : figure.type === "music" ? (
        <MusicFigure block={figure} activeTargetIds={activeTargetIds} />
      ) : visual ? (
        <VisualBoard
          block={visual}
          activeTargetIds={activeTargetIds}
          previousActiveTargetIds={previousActiveTargetIds}
          progress={beatEnter}
          reading={options.mode === "chat"}
          animate={options.animate}
          contentSize={figureSize ?? options.contentSize}
          timelineTick={options.teachingTimeline?.tick}
        />
      ) : figure.type === "compare" && compareSides.length >= 2 ? (
        <LegacyCompareStage
          block={figure}
          activeTargetIds={activeTargetIds}
          previousActiveTargetIds={previousActiveTargetIds}
          clocked={clocked}
          beatEnter={beatEnter}
        />
      ) : figure.type === "code" && options.renderCode ? (
        options.renderCode(figure, { contentSized })
      ) : figure.type === "code" ? (
        <StageCodeBoard
          contentSized={contentSized}
          block={figure}
          activeTargetIds={activeTargetIds}
          previousActiveTargetIds={previousActiveTargetIds}
          clocked={clocked}
          beatEnter={beatEnter}
        />
      ) : (svgMarkup || imageUrl) && options.renderMedia ? (
        options.renderMedia(figure)
      ) : svgMarkup || imageUrl ? (
        <CourseMediaScene
          interactive={options.mode === "chat"}
          scene={
            {
              slots: { mediaKind: String(figure.type ?? "media") },
            } as unknown as CourseDisplayScene
          }
          mediaBlock={figure}
          activeTargetIds={activeTargetIds}
          previousActiveTargetIds={previousActiveTargetIds}
          clocked={clocked}
          beatEnter={beatEnter}
          nested
        />
      ) : (
        <ClassroomCopyCard
          figure={figure}
          isCallout={isCallout}
          variant={figureVariant}
          activeTargetIds={activeTargetIds}
          previousActiveTargetIds={previousActiveTargetIds}
          clocked={clocked}
          beatEnter={beatEnter}
        />
      )}
    </div>
  );
}

function ClassroomCopyCard({
  figure,
  isCallout,
  variant,
  activeTargetIds = [],
  previousActiveTargetIds = [],
  clocked = false,
  beatEnter,
}: {
  figure: CourseDisplayBlock;
  isCallout: boolean;
  variant?: string;
  activeTargetIds?: readonly string[];
  previousActiveTargetIds?: readonly string[];
  clocked?: boolean;
  beatEnter?: number;
}) {
  const options = useContext(BoardOptionsContext);
  const kind = (
    variant && variant in CLASSROOM_CALLOUT_LABELS ? variant : "tip"
  ) as CourseCalloutVariant;
  const title = String(figure.title ?? figure.caption ?? "").trim();
  const body = String(
    figure.body ?? figure.summary ?? figure.caption ?? figure.alt ?? "",
  );
  return (
    <div
      className={cn("lp-composed-figure-copy", isCallout && "is-callout")}
      data-lp-figure-type={figure.type}
      data-lp-figure-variant={variant}
    >
      <CourseCallout
        presentation={options.calloutPresentation}
        variant={kind}
        label={CLASSROOM_CALLOUT_LABELS[kind]!}
        title={title ? <ClassroomBoardCopy content={title} /> : undefined}
        body={
          <CourseCalloutBody
            presentation={options.calloutPresentation}
            reserveSpace={options.mode !== "chat"}
            figure={figure} body={body}
            activeTargetIds={activeTargetIds} previousActiveTargetIds={previousActiveTargetIds}
            revealedTargetIds={options.revealedTargetIds}
            previousRevealedTargetIds={options.previousRevealedTargetIds}
            clocked={options.mode !== "chat" && clocked}
            animate={Boolean(options.animate)} progress={beatEnter}
          />
        }
      />
    </div>
  );
}

function ComposedStageScene({
  mediaBlock,
  activeTargetIds,
  previousActiveTargetIds = [],
  clocked = false,
  beatEnter,
}: {
  mediaBlock?: CourseDisplayBlock;
  activeTargetIds: readonly string[];
  previousActiveTargetIds?: readonly string[];
  clocked?: boolean;
  beatEnter?: number;
}) {
  const options = useContext(BoardOptionsContext);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const layout: MaterialStageLayout = isMaterialStageLayout(
    String(mediaBlock?.layout ?? ""),
  )
    ? (mediaBlock!.layout as MaterialStageLayout)
    : "stack";
  const figures = Array.isArray(mediaBlock?.figures)
    ? (mediaBlock!.figures as CourseDisplayBlock[])
    : [];
  const slots = layoutSlots(layout, figures.length);
  const focusedIndexes = materialStageFocusIndexes({
    layout,
    figures,
    targetIds: activeTargetIds,
  });
  const previousFocusedIndexes = materialStageFocusIndexes({
    layout,
    figures,
    targetIds: previousActiveTargetIds,
  });
  const content = options.contentSize ?? classroomContentRect("content");
  const cardBuild = supportsCourseCardBuild(mediaBlock) && options.revealedTargetIds !== undefined;
  const presentation = isMaterialPresentation(mediaBlock?.presentation)
    ? mediaBlock.presentation
    : cardBuild ? "steps" : undefined;
  const surface =
    presentation && options.mode === "chat"
      ? content.width < (cardBuild ? 600 : 760)
        ? "reading-narrow"
        : "reading-wide"
      : "classroom";
  const containerAspectRatio = content.width / Math.max(1, content.height);
  const canvasPlan = resolveMaterialStageLayout({
    containerAspectRatio,
    layout,
    figures,
    surface,
    stableComposition: Boolean(presentation),
  });
  const currentPlan = resolveMaterialStageLayout({
    containerAspectRatio,
    layout,
    figures,
    surface,
    stableComposition: Boolean(presentation),
    focusedIndexes,
  });
  const previousPlan = resolveMaterialStageLayout({
    containerAspectRatio,
    layout,
    figures,
    surface,
    stableComposition: Boolean(presentation),
    focusedIndexes: previousFocusedIndexes,
  });
  const animate = clocked && beatEnter != null && !reducedMotion;
  const plan = animate
    ? interpolateMaterialStageLayout(previousPlan, currentPlan, beatEnter)
    : currentPlan;
  const typography = classroomStageTypography({
    previousPlan: canvasPlan,
    currentPlan: canvasPlan,
    figures,
    content: options.contentSize ?? classroomContentRect("content"),
    progress: 1,
  });
  if (presentation) {
    return (
      <PresentationStage
        key={`${mediaBlock?.id ?? "stage"}:${presentation}`}
        mode={presentation}
        cardBuild={cardBuild}
        revealedIndexes={cardBuild ? courseCardRevealedIndexes(mediaBlock!, options.revealedTargetIds!) : undefined}
        previousRevealedIndexes={cardBuild && options.previousRevealedTargetIds
          ? courseCardRevealedIndexes(mediaBlock!, options.previousRevealedTargetIds)
          : clocked && !previousActiveTargetIds.length ? [] : undefined}
        plan={currentPlan}
        figures={figures}
        contentSize={content}
        reading={options.mode === "chat"}
        count={figures.length}
        focusedIndexes={focusedIndexes}
        previousFocusedIndexes={previousFocusedIndexes}
        progress={beatEnter ?? 1}
        clocked={options.mode !== "chat" && clocked}
        animate={Boolean(options.animate)}
        renderFigure={(index) => (
          <StageFigurePane
            contentSized
            figure={figures[index]!}
            targetId={classroomStageTargetId(layout, index)}
            activeTargetIds={activeTargetIds}
            previousActiveTargetIds={previousActiveTargetIds}
            clocked={clocked}
            beatEnter={beatEnter}
            focused={focusedIndexes.includes(index)}
            figureSize={{
              width: content.width * currentPlan.items[index]!.rect.width,
              height: content.height * currentPlan.items[index]!.rect.height,
            }}
          />
        )}
      />
    );
  }
  const isContentCardStack =
    layout === "stack" &&
    figures.length > 0 &&
    figures.every((figure) =>
      ["callout", "paragraph", "heading", "text", "legacy_board"].includes(
        figure.type,
      ),
    );
  const pictureIndex = figures.findIndex((figure) =>
    ["illustration", "svg", "svg_slot"].includes(figure.type),
  );
  const pictureWithNote =
    figures.length === 2 &&
    pictureIndex >= 0 &&
    currentPlan.items[1 - pictureIndex]?.kind === "card";
  const textBoard =
    layout !== "main+rail" && layout !== "split-v"
      ? courseTextBoard(figures)
      : null;
  if (textBoard)
    return (
      <CourseTextBoard
        board={textBoard}
        figures={figures}
        plan={plan}
        labels={CLASSROOM_CALLOUT_LABELS}
      />
    );
  return (
    <div
      className="lp-composed-stage"
      data-fixed-views={options.mode !== "chat" || undefined}
      style={materialStagePlanStyle(plan)}
      data-layout={layout}
      data-picture-layout={
        pictureWithNote
          ? materialStagePicturePlacement(
              figures[pictureIndex]!,
              containerAspectRatio,
            )
          : undefined
      }
      data-lp-stage-presentation={plan.presentation}
      data-lp-stack-style={isContentCardStack ? "content-cards" : undefined}
    >
      {plan.order.map((index) => {
        const figure = figures[index]!;
        const item = plan.items[index]!;
        const canvas = options.mode === "chat" ? item : canvasPlan.items[index]!;
        return (
          <div
            key={`${slots[index] ?? index}`}
            className="lp-composed-stage-slot"
            style={{
              ...(options.mode === "chat"
                ? materialStageItemStyle(item)
                : materialStageCanvasStyle(item, canvas, reducedMotion)),
              ...(options.mode === "chat"
                ? { "--lp-stage-type": "1em" }
                : classroomStageTypeStyle(typography[index] ?? CLASSROOM_STAGE_TYPE_BASE)),
            }}
            data-stage-index={index}
            data-stage-picture={
              pictureWithNote && index === pictureIndex ? "true" : undefined
            }
            data-stage-density={canvas.density}
            data-focused={item.focused ? "true" : undefined}
          >
            <StageFigurePane
              figure={figure}
              targetId={classroomStageTargetId(layout, index)}
              activeTargetIds={activeTargetIds}
              previousActiveTargetIds={previousActiveTargetIds}
              clocked={clocked}
              beatEnter={beatEnter}
              focused={item.focused}
              figureSize={{
                width: content.width * canvas.rect.width,
                height: content.height * canvas.rect.height,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

type ClassroomConversationTurn = Readonly<{
  speaker: string;
  text: string;
}>;

function conversationTurns(
  block: CourseDisplayBlock | undefined,
): ClassroomConversationTurn[] {
  if (!Array.isArray(block?.turns)) return [];
  return block.turns.filter(
    (turn): turn is ClassroomConversationTurn =>
      Boolean(turn && typeof turn === "object") &&
      typeof (turn as { speaker?: unknown }).speaker === "string" &&
      typeof (turn as { text?: unknown }).text === "string",
  );
}

export function CourseConversationScene(props: {
  title: string;
  mediaBlock?: CourseDisplayBlock;
}) {
  const turns = conversationTurns(props.mediaBlock);
  const speakers = [...new Set(turns.map((turn) => turn.speaker))];
  return (
    <div className="lp-conversation-scene" data-lp-target="conversation">
      <div className="lp-conversation-heading">
        <MessageCircle aria-hidden="true" />
        <h3>{props.title || "一段对话"}</h3>
      </div>
      <div className="lp-conversation-turns">
        {turns.length > 0 ? (
          turns.map((turn, index) => {
            const speakerIndex = Math.max(0, speakers.indexOf(turn.speaker));
            const isRight = speakerIndex % 2 === 1;
            return (
              <div
                key={`${turn.speaker}-${index}`}
                className={cn("lp-conversation-turn", isRight && "is-right")}
              >
                <div className="lp-conversation-avatar" aria-hidden="true">
                  {turn.speaker.trim().slice(0, 1) || "?"}
                </div>
                <div className="lp-conversation-message">
                  <span>{turn.speaker}</span>
                  <p>{turn.text}</p>
                </div>
              </div>
            );
          })
        ) : (
          <p className="lp-conversation-empty">这段对话暂时没有内容。</p>
        )}
      </div>
    </div>
  );
}

function ContentScene({
  scene,
  mediaBlock,
  activeTargetIds = [],
  previousActiveTargetIds = [],
  clocked = false,
  beatEnter,
}: {
  scene: Pick<CourseDisplayScene, "templateId" | "slots" | "title">;
  mediaBlock?: CourseDisplayBlock;
  activeTargetIds?: readonly string[];
  previousActiveTargetIds?: readonly string[];
  clocked?: boolean;
  beatEnter?: number;
}) {
  const options = useContext(BoardOptionsContext);
  // Both music versions must terminate at the native renderer. The reading
  // fallback routes music back through MaterialBlockView -> CourseChatBoard,
  // so delegating an unrecognized version to renderMedia recurses forever.
  if (mediaBlock?.type === "teaching") {
    const teaching = readMaterialTeaching(mediaBlock);
    return teaching ? <TeachingDisplay block={teaching} activeTargetIds={activeTargetIds}
      previousActiveTargetIds={previousActiveTargetIds} revealedTargetIds={options.revealedTargetIds}
      progress={beatEnter} reading={options.mode === "chat"} animate={options.animate}
      timeline={options.teachingTimeline}/> : <TeachingUnavailable/>;
  }
  if (mediaBlock?.type === "music")
    return (
      <MusicFigure block={mediaBlock} activeTargetIds={activeTargetIds} />
    );
  const visual = readMaterialVisual(mediaBlock);
  if (visual)
    return (
      <VisualBoard
        block={visual}
        activeTargetIds={activeTargetIds}
        previousActiveTargetIds={previousActiveTargetIds}
        progress={beatEnter}
        reading={options.mode === "chat"}
        animate={options.animate}
        contentSize={options.contentSize}
        timelineTick={options.teachingTimeline?.tick}
      />
    );
  // An accepted accordion owns its complete copy even when a legacy scene maps
  // it to teacher_board and its slots contain only the title. Keep this terminal
  // branch ahead of template dispatch so exports never replace its body with slots.
  if (mediaBlock?.type === "accordion" ||
      (scene.templateId === "content.focus" && mediaBlock?.type === "callout")) {
    return (
      <div
        className="lp-semantic-focus"
        data-lp-target="focus"
        data-lp-lit={
          materialCueNodeLit(
            activeTargetIds,
            "focus",
            blockFigureId(mediaBlock),
          ) || activeTargetIds.some((id) => id.startsWith(`${blockFigureId(mediaBlock)}:detail-`))
            ? "true"
            : undefined
        }
      >
        <ClassroomCopyCard
          figure={mediaBlock}
          isCallout={mediaBlock.type === "callout"}
          variant={String(mediaBlock.variant ?? "tip")}
          activeTargetIds={activeTargetIds}
          previousActiveTargetIds={previousActiveTargetIds}
          clocked={clocked}
          beatEnter={beatEnter}
        />
      </div>
    );
  }
  if (scene.templateId === "content.compare") {
    const block =
      mediaBlock?.type === "compare"
        ? mediaBlock
        : {
            type: "compare",
            left: {
              label: scene.slots.leftLabel,
              points: classroomCompareSlotLines(scene.slots.left),
            },
            right: {
              label: scene.slots.rightLabel,
              points: classroomCompareSlotLines(scene.slots.right),
            },
          };
    return (
      <LegacyCompareStage
        block={block}
        activeTargetIds={activeTargetIds}
        previousActiveTargetIds={previousActiveTargetIds}
        clocked={clocked}
        beatEnter={beatEnter}
      />
    );
  }
  if (scene.templateId === "content.focus") {
    return (
      <div
        className="lp-focus-scene"
        data-lp-target="focus"
        data-lp-lit={
          materialCueNodeLit(
            activeTargetIds,
            "focus",
            blockFigureId(mediaBlock),
          )
            ? "true"
            : undefined
        }
      >
        <div className="lp-focus-beacon" aria-hidden="true">
          <span />
          <Lightbulb />
        </div>
        <div className="lp-focus-copy">
          <span>关键理解 · KEY INSIGHT</span>
          <h3>
            <ClassroomBoardCopy content={scene.slots.heading ?? ""} />
          </h3>
          <p>
            <ClassroomBoardCopy content={scene.slots.callout ?? ""} />
          </p>
        </div>
      </div>
    );
  }
  if (scene.templateId === "content.media") {
    if (scene.slots.mediaKind === "code" && mediaBlock && options.renderCode)
      return <>{options.renderCode(mediaBlock)}</>;
    if (mediaBlock && options.renderMedia)
      return <>{options.renderMedia(mediaBlock)}</>;
    return (
      <CourseMediaScene
        interactive={options.mode === "chat"}
        scene={scene}
        mediaBlock={mediaBlock}
        activeTargetIds={activeTargetIds}
        previousActiveTargetIds={previousActiveTargetIds}
        clocked={clocked}
        beatEnter={beatEnter}
      />
    );
  }
  if (scene.templateId === "content.stage") {
    return (
      <ComposedStageScene
        mediaBlock={mediaBlock}
        activeTargetIds={activeTargetIds}
        previousActiveTargetIds={previousActiveTargetIds}
        clocked={clocked}
        beatEnter={beatEnter}
      />
    );
  }
  if (scene.templateId === "content.conversation") {
    return (
      <CourseConversationScene
        title={scene.slots.title || scene.title}
        mediaBlock={mediaBlock}
      />
    );
  }
  return (
    <div className="lp-board-scene" data-lp-target="board">
      <div className="lp-board-rail" aria-hidden="true">
        <span />
      </div>
      <div className="lp-board-copy">
        <span className="lp-board-label">核心概念 · CORE IDEA</span>
        <h3>{scene.slots.heading || scene.title}</h3>
        <p>{scene.slots.body}</p>
      </div>
    </div>
  );
}
