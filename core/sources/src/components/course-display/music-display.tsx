import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { MusicTimelineContext } from "./music-teaching-display.js";
import {
  compileMaterialMusic,
  musicFrame,
  musicStepTarget,
  MUSIC_INSTRUMENTS,
  type MaterialMusic,
  type MusicSelection,
  type MusicInstrument,
} from "../../../libs/domain/src/index.js";
import {
  MUSIC_LABELS,
  MusicPlayer,
  type MusicPlayback,
} from "../../shared/music/audio.js";
import type { drawMusicScore } from "../../shared/music/score.js";
import "./music-display.css";

const noteName = (midi: number) =>
  `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`;
const black = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);
const allKeys = Array.from({ length: 88 }, (_, i) => i + 21);

/** Same score in reading and classroom. Semantic cues never regenerate its layout. */
export function MusicDisplay({
  block,
  activeTargetIds = [],
  interactive = true,
}: {
  block: MaterialMusic;
  activeTargetIds?: readonly string[];
  interactive?: boolean;
}) {
  const timeline = useContext(MusicTimelineContext);
  const music = timeline.music?.figureId === block.id ? timeline.music : undefined;
  const plan = useMemo(() => compileMaterialMusic(block), [block]);
  const root = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const score = useRef<ReturnType<typeof drawMusicScore> | undefined>(
    undefined,
  );
  const [scoreWidth, setScoreWidth] = useState(0);
  const [scoreRevision, setScoreRevision] = useState(0),
    [scoreError, setScoreError] = useState("");
  const [rendered, setRendered] = useState<{block: MaterialMusic; width: number} | null>(null);
  const [manualStep, setManualStep] = useState<string | null>(null),
    [variant, setVariant] = useState<"a" | "b">("a");
  const [notation, setNotation] = useState(block.notation ?? "both"),
    [speed, setSpeed] = useState(1);
  const [instrument, setInstrument] = useState<MusicInstrument | "authored">(
      "authored",
    ),
    [loop, setLoop] = useState(false),
    [fullKeyboard, setFullKeyboard] = useState(false);
  const [playback, setPlayback] = useState<MusicPlayback>({
    state: "paused",
    beat: 0,
  });
  const player = useRef<MusicPlayer | undefined>(undefined);
  const cueKey = activeTargetIds.join("|");
  const cueStep = block.steps.find(
    (step) =>
      activeTargetIds.includes(step.id) ||
      activeTargetIds.includes(musicStepTarget(block.id ?? "display", step.id)),
  );
  const selected =
    music ? block.steps.find(step => step.id === music.clipId) : manualStep === "whole"
      ? undefined
      : (block.steps.find((step) => step.id === manualStep) ?? cueStep);
  const overview: MusicSelection = {
    bars: [1, plan.barCount],
    parts: block.parts.map((part) => part.id),
  };
  const baseSelection =
    !music && variant === "b" && selected?.compare
      ? selected.compare
      : (selected ?? overview);
  const selection = useMemo(
    (): MusicSelection => ({
      ...baseSelection,
      ...(instrument === "authored" || music
        ? {}
        : {
            instruments: baseSelection.parts.map((part) => ({
              part,
              instrument,
            })),
          }),
    }),
    [JSON.stringify(baseSelection), instrument, Boolean(music)],
  );
  const from = (selection.bars[0]! - 1) * plan.barBeats,
    to = selection.bars[1]! * plan.barBeats;
  const beat = music ? from + ((music.elapsedTicks ?? 0) / 48_000 * block.tempo / 60) % (to - from) : Math.max(from, Math.min(to, playback.beat));
  const activeNotes =
    music ? plan.notes.filter(note => music.targetIds.includes(note.eventId)) : playback.state === "playing" ? musicFrame(plan, selection, beat).notes : [];
  const activeMidi = new Set(activeNotes.map((n) => n.pitch.midi));
  const focused = new Set(variant === "a" ? (selected?.focus ?? []) : []);
  const focusedMidi = new Set(
    plan.notes.filter((n) => focused.has(n.eventId)).map((n) => n.pitch.midi),
  );
  const low = Math.max(
    21,
    Math.floor(
      (Math.min(...plan.notes.map((n) => n.pitch.midi), 60) - 3) / 12,
    ) * 12,
  );
  const high = Math.min(
    108,
    Math.ceil((Math.max(...plan.notes.map((n) => n.pitch.midi), 60) + 3) / 12) *
      12,
  );
  const whiteKeys = allKeys.filter((midi) => !black(midi));

  useEffect(() => {
    const instance = new MusicPlayer(setPlayback);
    player.current = instance;
    const hide = () => {
      if (document.hidden) instance.pause();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      instance.dispose();
      player.current = undefined;
    };
  }, []);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => !entry.isIntersecting))
        player.current?.pause();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setManualStep(null);
    setVariant("a");
  }, [cueKey, block]);
  useEffect(() => {
    player.current?.pause();
    setPlayback({ state: "paused", beat: from });
  }, [plan, selection, speed, from]);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver(() =>
      setScoreWidth(Math.round(node.clientWidth)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setScoreError("");
    setRendered(null);
    import("../../shared/music/score.js")
      .then(async ({ drawMusicScore }) => {
        await document.fonts.ready;
        if (!cancelled && host.current) {
          score.current = drawMusicScore(host.current, plan);
          setRendered({block, width: scoreWidth});
          setScoreRevision((n) => n + 1);
        }
      })
      .catch((error) => {
        if (!cancelled) setScoreError(String(error));
      });
    return () => {
      cancelled = true;
      score.current = undefined;
    };
  }, [plan, scoreWidth]);
  useEffect(() => {
    const drawing = score.current;
    if (!drawing) return;
    const playingIds = new Set(activeNotes.map((n) => n.eventId));
    drawing.nodes.forEach((nodes, id) =>
      nodes.forEach((node) => {
        node.classList.toggle("is-playing", playingIds.has(id));
        node.classList.toggle("is-focus", focused.has(id));
      }),
    );
    drawing.root
      .querySelectorAll<SVGGElement>("[data-part]")
      .forEach((group) => {
        const bar = Number(group.dataset.bar);
        group.style.opacity =
          selection.parts.includes(group.dataset.part!) &&
          bar >= selection.bars[0]! &&
          bar <= selection.bars[1]!
            ? "1"
            : ".3";
      });
    const bar = Math.min(
      plan.barCount,
      Math.floor(Math.min(beat, to - 0.001) / plan.barBeats) + 1,
    );
    const pane = scroll.current;
    if (pane) {
      const x = (bar - 1) * drawing.barWidth;
      if (
        x < pane.scrollLeft ||
        x + drawing.barWidth > pane.scrollLeft + pane.clientWidth + 1
      )
        pane.scrollLeft = x;
    }
  }, [scoreRevision, playback, selection, selected, variant, plan, beat, to]);
  const choose = (id: string | null) => {
    setManualStep(id);
    setVariant("a");
  };
  const togglePlay = () =>
    playback.state === "playing" || playback.state === "loading"
      ? player.current?.pause()
      : void player.current?.play(plan, selection, speed, beat, loop);
  const keyStyle = (midi: number) => {
    const before = whiteKeys.filter((k) => k < midi).length;
    return {
      left: `${((black(midi) ? before - 0.31 : before) / whiteKeys.length) * 100}%`,
      width: `${((black(midi) ? 0.62 : 1) / whiteKeys.length) * 100}%`,
    };
  };
  return (
    <section
      ref={root}
      className="music-display"
      data-music-clocked={timeline.clocked ? "true" : undefined}
      data-music-state={music ? "playing" : playback.state}
      data-music-step={selected?.id ?? "whole"}
      data-remotion-resource-status={timeline.reportRemotionStatus
        ? scoreError ? "error" : scoreWidth > 0 && rendered?.block === block && rendered.width === scoreWidth ? "ready" : "loading"
        : undefined}
      aria-label={block.title}
    >
      <header className="music-heading">
        <strong>{block.title}</strong>
        <span>
          1 = C · {block.meter} · ♩ = {Math.round(block.tempo * speed)}
        </span>
      </header>
      <div className="music-step-nav" aria-label="乐谱讲解步骤">
        <button
          type="button"
          aria-pressed={!selected}
          onClick={() => choose("whole")}
        >
          全曲
        </button>
        {block.steps.map((step, i) => (
          <button
            type="button"
            key={step.id}
            data-lp-target={musicStepTarget(block.id ?? "display", step.id)}
            aria-pressed={selected?.id === step.id}
            onClick={() => choose(step.id)}
          >
            {i + 1} · {step.label}
          </button>
        ))}
      </div>
      <div
        className="music-score-scroll"
        ref={scroll}
        tabIndex={0}
        aria-label="乐谱，可横向滚动"
      >
        <div ref={host} className={`music-score notation-${notation}`} />
      </div>
      {scoreError && <p role="alert">乐谱未能载入：{scoreError}</p>}
      <div className="music-selection">
        <span>
          {selected?.label ?? "全曲"} · 第 {selection.bars.join("–")} 小节
        </span>
        <label>
          谱面{" "}
          <select
            aria-label="谱面"
            value={notation}
            onChange={(e) => setNotation(e.target.value as typeof notation)}
          >
            <option value="both">五线谱与简谱</option>
            <option value="staff">五线谱</option>
            <option value="jianpu">简谱</option>
          </select>
        </label>
      </div>
      {block.keyboard && (
        <div className="music-keyboard-section">
          <div className="music-selection">
            <span>
              键盘 ·{" "}
              {fullKeyboard
                ? "A0–C8 · 88 键"
                : `${noteName(low)}–${noteName(high)}`}
            </span>
            <button type="button" onClick={() => setFullKeyboard((v) => !v)}>
              {fullKeyboard ? "当前音区" : "完整键盘"}
            </button>
          </div>
          <div className="music-keyboard-scroll">
            <div
              className="music-keyboard-window"
              style={{
                width: fullKeyboard
                  ? "100%"
                  : `${(whiteKeys.filter((k) => k >= low && k <= high).length / whiteKeys.length) * 100}%`,
              }}
            >
              <div
                className="music-keyboard"
                style={{
                  width: fullKeyboard
                    ? "100%"
                    : `${(whiteKeys.length / whiteKeys.filter((k) => k >= low && k <= high).length) * 100}%`,
                  transform: fullKeyboard
                    ? undefined
                    : `translateX(-${(whiteKeys.filter((k) => k < low).length / whiteKeys.length) * 100}%)`,
                }}
              >
                {allKeys.map((midi) => (
                  <button
                    type="button"
                    key={midi}
                    className={`${black(midi) ? "black" : "white"}${activeMidi.has(midi) ? " is-playing" : ""}${focusedMidi.has(midi) ? " is-focus" : ""}`}
                    style={keyStyle(midi)}
                    aria-label={`试听 ${noteName(midi)}`}
                    tabIndex={
                      fullKeyboard || (midi >= low && midi <= high) ? 0 : -1
                    }
                    disabled={!interactive || timeline.clocked || Boolean(music)}
                    onClick={() =>
                      void player.current?.audition(
                        midi,
                        instrument === "authored" ? "piano" : instrument,
                      )
                    }
                  >
                    {!black(midi) ? noteName(midi) : ""}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="music-controls">
        <button
          type="button"
          className="music-play"
          disabled={!interactive}
          onClick={togglePlay}
        >
          {playback.state === "loading"
            ? "取消准备"
            : playback.state === "playing"
              ? "暂停"
              : "播放"}
        </button>
        <button
          type="button"
          onClick={() => {
            player.current?.pause();
            setPlayback({ state: "paused", beat: from });
          }}
        >
          重来
        </button>
        <label>
          进度{" "}
          <input
            aria-label="播放进度"
            type="range"
            min={from}
            max={to}
            step="0.05"
            value={beat}
            onChange={(e) => {
              player.current?.pause();
              setPlayback({ state: "paused", beat: Number(e.target.value) });
            }}
          />
        </label>
        <label>
          速度{" "}
          <select
            aria-label="速度"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {[0.5, 0.75, 1, 1.25, 1.5].map((v) => (
              <option value={v} key={v}>
                {v}×
              </option>
            ))}
          </select>
        </label>
        <label>
          音色{" "}
          <select
            aria-label="音色"
            value={instrument}
            onChange={(e) => setInstrument(e.target.value as typeof instrument)}
          >
            <option value="authored">谱面音色（默认钢琴）</option>
            {MUSIC_INSTRUMENTS.map((id) => (
              <option key={id} value={id}>
                {MUSIC_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => {
              player.current?.pause();
              setLoop(e.target.checked);
            }}
          />{" "}
          循环
        </label>
      </div>
      {block.steps.some((step) => step.compare) && (
        <div
          className="music-comparison"
          aria-label="试听对比"
          style={{ visibility: selected?.compare ? "visible" : "hidden" }}
          aria-hidden={!selected?.compare}
        >
          <button
            type="button"
            aria-pressed={variant === "a"}
            onClick={() => setVariant("a")}
          >
            A · {selected?.label ?? "原句"}
          </button>
          <button
            type="button"
            aria-pressed={variant === "b"}
            onClick={() => setVariant("b")}
          >
            B · {selected?.compare?.label ?? "对比"}
          </button>
          <span>选择后点击播放</span>
        </div>
      )}
      {playback.error && (
        <p role="alert">{playback.error}。可再次点击播放重试。</p>
      )}
      <details className="music-attribution">
        <summary>音源说明</summary>FluidR3_GM / Frank Wen 与贡献者；MIDI.js
        Soundfonts，CC BY 3.0。本地采样与近似延音模拟。
        <a
          href="https://github.com/gleitz/midi-js-soundfonts/tree/gh-pages/FluidR3_GM"
          target="_blank"
          rel="noreferrer"
        >
          来源
        </a>
      </details>
    </section>
  );
}
