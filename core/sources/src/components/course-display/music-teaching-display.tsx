import { useT } from "../../shared/i18n/index.js";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  compileMusicTeachingClip,
  musicStepTarget,
  type MaterialMusicTeaching,
} from "../../../libs/domain/src/index.js";
import type { MusicPlaybackState } from "../../../libs/domain/src/index.js";
import type { drawMusicTeaching } from "../../shared/music/teaching-score.js";
import { MusicPlayer } from "../../shared/music/audio.js";
import { MusicClipPlayer } from "../../shared/music/clip-player.js";
import { sampleMusicNarrationFocus } from "../../shared/music/narration-focus.js";
import { InlineMathText } from "../markdown/inline-math-text.js";
import { ProseMarkdown } from "../markdown/prose-markdown.js";
import "./music-display.css";
import "./music-teaching-display.css";

export const MusicTimelineContext = createContext<{
  music?: MusicPlaybackState;
  clocked: boolean;
  reportRemotionStatus?: boolean;
  narration?: { progress: number; previousTargetIds: readonly string[] };
}>({ clocked: false });

export function MusicTeachingDisplay({
  block,
  activeTargetIds = [],
  interactive = true,
  reportRemotionStatus = false,
}: {
  block: MaterialMusicTeaching;
  activeTargetIds?: readonly string[];
  interactive?: boolean;
  /** Production capture must wait for the asynchronous VexFlow drawing. */
  reportRemotionStatus?: boolean;
}) {
  const t = useT();
  const timeline = useContext(MusicTimelineContext);
  const reportStatus =
    reportRemotionStatus || timeline.reportRemotionStatus === true;
  const host = useRef<HTMLDivElement>(null),
    drawing = useRef<ReturnType<typeof drawMusicTeaching> | null>(null);
  const [width, setWidth] = useState(0),
    [revision, setRevision] = useState(0),
    [error, setError] = useState("");
  const [rendered, setRendered] = useState<{
    block: MaterialMusicTeaching;
    width: number;
  } | null>(null);
  const [manual, setManual] = useState<{ clipId: string; tick: number } | null>(
    null,
  );
  const player = useRef<MusicClipPlayer | null>(null),
    audition = useRef<MusicPlayer | null>(null);
  const clips = useMemo(
    () =>
      new Map(
        (block.clips ?? []).map((c) => [
          c.id,
          compileMusicTeachingClip(block, c.id),
        ]),
      ),
    [block],
  );
  const cueKey = activeTargetIds.join("|");
  useEffect(() => {
    const instance = new MusicClipPlayer();
    player.current = instance;
    const keys = new MusicPlayer(() => undefined);
    audition.current = keys;
    const hide = () => {
      if (document.hidden) {
        instance.stop();
        keys.pause();
        setManual(null);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      instance.dispose();
      keys.dispose();
    };
  }, []);
  useEffect(() => {
    player.current?.stop();
    audition.current?.pause();
    setManual(null);
  }, [block, cueKey, timeline.clocked]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (host.current === element) setWidth(Math.round(element.clientWidth));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setError("");
    setRendered(null);
    import("../../shared/music/teaching-score.js")
      .then(async ({ drawMusicTeaching }) => {
        const draw = () => {
          if (cancelled || !host.current) return;
          drawing.current = drawMusicTeaching(
            host.current,
            block,
            (midi) => {
              player.current?.stop();
              setManual(null);
              void audition.current?.audition(midi, "piano");
            },
            interactive && !timeline.clocked,
            { compact: timeline.clocked },
          );
          setRevision((n) => n + 1);
          setRendered({ block, width });
        };
        // The first KaTeX label may request fonts. Settle its measured lanes
        // once those fonts load; later cue updates only change emphasis.
        if (reportStatus && document.fonts?.status === "loading") {
          await document.fonts.ready;
          draw();
        } else {
          draw();
          if (document.fonts?.status === "loading")
            void document.fonts.ready.then(draw);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
      drawing.current = null;
    };
  }, [block, width, interactive, timeline.clocked, reportStatus]);
  const music =
    timeline.music?.figureId === block.id ? timeline.music : undefined;
  const manualPlan = manual ? clips.get(manual.clipId) : undefined;
  const playing =
    music?.targetIds ??
    manualPlan?.notes
      .filter(
        (n) =>
          manual!.tick >= n.startTick &&
          manual!.tick < n.startTick + n.durationTicks,
      )
      .map((n) => n.targetId) ??
    [];
  const midi =
    music?.midi ??
    manualPlan?.notes
      .filter(
        (n) =>
          manual!.tick >= n.startTick &&
          manual!.tick < n.startTick + n.durationTicks,
      )
      .map((n) => n.midi) ??
    [];
  useEffect(() => {
    const draw = drawing.current;
    if (!draw) return;
    const focus = (id: string) =>
      activeTargetIds.includes(id) ||
      activeTargetIds.includes(musicStepTarget(block.id, id));
    const overview =
      !activeTargetIds.length ||
      activeTargetIds.includes("whole") ||
      activeTargetIds.includes(block.id);
    draw.nodes.forEach((nodes, id) =>
      nodes.forEach((node) => {
        node.classList.toggle("is-focus", focus(id));
        node.classList.toggle("is-playing", playing.includes(id));
      }),
    );
    draw.keys.forEach((nodes, key) =>
      nodes.forEach((node) =>
        node.classList.toggle("is-playing", midi.includes(key)),
      ),
    );
    draw.marks.forEach((node, id) => {
      node.style.opacity = overview
        ? "1"
        : String(
            sampleMusicNarrationFocus({
              figureId: block.id,
              targetId: id,
              targetIds: activeTargetIds,
              previousTargetIds: timeline.narration?.previousTargetIds,
              progress: timeline.narration?.progress,
            }),
          );
    });
    draw.focusIndicators.forEach((indicators, id) => {
      const amount = sampleMusicNarrationFocus({
        figureId: block.id,
        targetId: id,
        targetIds: activeTargetIds,
        previousTargetIds: timeline.narration?.previousTargetIds,
        progress: timeline.narration?.progress,
      });
      indicators.forEach(({ group, trace, pointer }) => {
        group.setAttribute("opacity", String(amount));
        trace.setAttribute("stroke-dasharray", `${amount} 1`);
        // The measured transform stays immutable; only its own small entrance
        // offset changes, leaving the notation and annotation geometry intact.
        pointer.style.translate =
          pointer.dataset.focusAxis === "y"
            ? `0 ${(1 - amount) * 8}px`
            : `${(1 - amount) * -8}px 0`;
      });
    });
  }, [
    cueKey,
    playing.join("|"),
    midi.join("|"),
    revision,
    block,
    timeline.narration?.progress,
    timeline.narration?.previousTargetIds.join("|"),
  ]);
  const play = async (id: string) => {
    if (manual?.clipId === id) {
      player.current?.stop();
      setManual(null);
      return;
    }
    setError("");
    audition.current?.pause();
    setManual({ clipId: id, tick: -1 });
    try {
      await player.current?.play(clips.get(id)!, 0, (tick) =>
        setManual(tick == null ? null : { clipId: id, tick }),
      );
    } catch (e) {
      setManual(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section
      className="music-display music-teaching"
      data-music-version="2"
      data-music-clocked={timeline.clocked}
      data-remotion-resource-status={
        reportStatus
          ? error
            ? "error"
            : width > 0 && rendered?.block === block && rendered.width === width
              ? "ready"
              : "loading"
          : undefined
      }
      data-music-state={
        manual?.tick === -1 ? "loading" : music || manual ? "playing" : "paused"
      }
      aria-label={block.title}
    >
      <header className="music-heading">
        <ProseMarkdown
          className="music-teaching-title"
          content={block.title}
          variant="board"
        />
        <span className="music-playback-label">
          {music ? (
            <>
              {t("display.ui.playing")}
              <InlineMathText text={music.label} />
            </>
          ) : (
            "\u00a0"
          )}
        </span>
      </header>
      <div ref={host} className="music-teaching-canvas" />
      {!timeline.clocked && interactive && !!block.clips?.length && (
        <div className="music-controls">
          {block.clips.map((clip) => (
            <button
              key={clip.id}
              onClick={() => void play(clip.id)}
              aria-pressed={manual?.clipId === clip.id}
            >
              {manual?.clipId === clip.id
                ? t("display.ui.stop")
                : t("display.ui.listen")}{" "}
              · <InlineMathText text={clip.label} />
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!timeline.clocked && !!block.clips?.length && (
        <details className="music-attribution">
          <summary>{t("display.ui.soundSource")}</summary>
          {t("display.ui.fluidr3GmCcBy30LocalSamples")}
          <a
            href="https://member.keymusician.com/Member/FluidR3_GM/index.html"
            target="_blank"
            rel="noreferrer"
          >
            {t("display.ui.source")}
          </a>
        </details>
      )}
    </section>
  );
}
