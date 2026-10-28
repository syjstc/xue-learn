import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  createDisplayClock,
  type DisplayDocument,
  type DisplayNode,
  type DisplayRuntime,
} from "../../../libs/display/src/index.js";
import {
  DisplayRuntimeSurface,
  type DisplayRenderer,
} from "../display-runtime/index.js";
import { DISPLAY_PREVIEW_FPS } from "./preview-catalog.js";

function sampleTeaching(node: DisplayNode, frame: number): DisplayNode {
  return {
    ...node,
    payload: ["general:teaching", "math:teaching", "music:teaching", "physics:teaching"].includes(node.kind)
      ? {
          ...(node.payload as object),
          artFrame: (frame * 60) / DISPLAY_PREVIEW_FPS,
          artFps: 60,
        }
      : node.payload,
    children: node.children?.map((child) => sampleTeaching(child, frame)),
    slots: node.slots
      ? Object.fromEntries(
          Object.entries(node.slots).map(([key, children]) => [
            key,
            children.map((child) => sampleTeaching(child, frame)),
          ]),
        )
      : undefined,
  };
}

/** Posters and players use the same runtime as course and video surfaces. */
export function DisplayPluginPreview({
  document,
  runtime,
  poster = false,
}: {
  document: DisplayDocument;
  runtime: DisplayRuntime<DisplayRenderer>;
  poster?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!poster);
  const [frame, setFrame] = useState(DISPLAY_PREVIEW_FPS * 5);
  const [playing, setPlaying] = useState(false);
  const duration = Math.max(
    1,
    Math.ceil(
      ((document.durationTicks ?? 576000) /
        (document.ticksPerSecond ?? 48000)) *
        DISPLAY_PREVIEW_FPS,
    ),
  );
  useEffect(() => {
    if (!poster || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, [poster]);
  useEffect(() => {
    setPlaying(false);
    setFrame(Math.min(DISPLAY_PREVIEW_FPS * 5, duration - 1));
  }, [document, duration]);
  useEffect(() => {
    if (!playing) return;
    let animation = 0,
      start: number | undefined;
    const first = frame;
    const advance = (now: number) => {
      start ??= now;
      const next =
        first + Math.floor(((now - start) * DISPLAY_PREVIEW_FPS) / 1000);
      if (next >= duration - 1) {
        setFrame(duration - 1);
        setPlaying(false);
        return;
      }
      setFrame(next);
      animation = requestAnimationFrame(advance);
    };
    animation = requestAnimationFrame(advance);
    const hide = () => {
      if (window.document.hidden) setPlaying(false);
    };
    window.document.addEventListener("visibilitychange", hide);
    return () => {
      cancelAnimationFrame(animation);
      window.document.removeEventListener("visibilitychange", hide);
    };
    // frame is the starting point of this playback session.
  }, [playing, duration, document]);
  const sampled = useMemo(
    () => ({ ...document, root: sampleTeaching(document.root, frame) }),
    [document, frame],
  );
  const seconds = frame / DISPLAY_PREVIEW_FPS;
  return (
    <div
      ref={host}
      className={poster ? "display-plugin-poster" : "display-plugin-player"}
    >
      <div
        className="display-plugin-stage"
        aria-hidden={poster || undefined}
        inert={poster || undefined}
      >
        {visible ? (
          <DisplayRuntimeSurface
            document={sampled}
            runtime={runtime}
            clock={createDisplayClock(frame, DISPLAY_PREVIEW_FPS, { playing })}
            mode={poster ? "video" : "interactive"}
          />
        ) : (
          <span className="display-plugin-preview-loading">正在准备预览…</span>
        )}
      </div>
      {!poster && (
        <div className="display-plugin-player-controls">
          <button
            type="button"
            className="display-plugin-primary"
            aria-label={playing ? "暂停预览" : "播放预览"}
            onClick={() => {
              if (!playing && frame >= duration - 1) setFrame(0);
              setPlaying((value) => !value);
            }}
          >
            {playing ? "Ⅱ 暂停" : "▷ 播放"}
          </button>
          <button
            type="button"
            aria-label="从头预览"
            onClick={() => {
              setPlaying(false);
              setFrame(0);
            }}
          >
            ↺
          </button>
          <input
            type="range"
            min={0}
            max={duration - 1}
            value={frame}
            aria-label="预览进度"
            aria-valuetext={`${seconds.toFixed(1)} 秒`}
            onChange={(event) => {
              setPlaying(false);
              setFrame(Number(event.target.value));
            }}
          />
          <span className="display-plugin-player-time">
            {seconds.toFixed(1)} / {(duration / DISPLAY_PREVIEW_FPS).toFixed(1)}{" "}
            s
          </span>
        </div>
      )}
    </div>
  );
}
