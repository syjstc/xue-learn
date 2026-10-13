import { useContext, useId } from "react";
import {
  guidedImageActiveRegions,
  guidedImageHighlightRegions,
  guidedImageCameraFrame,
  imagePolygonPath,
  type GuidedImageDisplay as Display,
} from "../../../libs/domain/src/index.js";
import "./guided-image.css";
import {
  GuidedImageTimelineContext,
  useGuidedImageTransition,
} from "./use-guided-image-transition.js";
import { useGuidedImageCamera } from "./use-guided-image-camera.js";
import { useT } from "../../shared/i18n/index.js";

/** One masked image keeps overlapping subject/label selections seamless and
 * preserves source alpha. The mask shares the image's coordinate system. */
export function GuidedImageDisplay({
  display,
  activeBeatId,
  activeTargetIds,
  previousActiveTargetIds = [],
  clocked = false,
  beatEnter = 1,
  showRegions = false,
  interactive = true,
  assetUrl = (src) => src,
}: {
  display: Display;
  activeBeatId?: string;
  activeTargetIds?: readonly string[];
  previousActiveTargetIds?: readonly string[];
  clocked?: boolean;
  beatEnter?: number;
  showRegions?: boolean;
  /** Classroom follows the video camera without exposing reading controls. */
  interactive?: boolean;
  assetUrl?: (src: string) => string;
}) {
  const timeline = useContext(GuidedImageTimelineContext);
  const animateCamera = !showRegions && !timeline;
  // beatEnter already carries ease-out-cubic; the geometry samplers apply it
  // themselves. Recover elapsed progress to avoid a near-instant double ease.
  const progress =
    timeline && clocked
      ? 1 - Math.cbrt(1 - Math.max(0, Math.min(1, beatEnter)))
      : beatEnter;
  const uid = useId().replace(/:/g, "");
  const { width, height } = display.image;
  const regions = guidedImageHighlightRegions(
    display.segmentation,
    display.image,
  );
  const active = activeTargetIds
    ? regions.filter(
        (region) =>
          activeTargetIds.includes(region.id) ||
          activeTargetIds.includes(`image:${region.id}`),
      )
    : guidedImageActiveRegions(display, activeBeatId);
  const previous = regions.filter(
    (region) =>
      previousActiveTargetIds.includes(region.id) ||
      previousActiveTargetIds.includes(`image:${region.id}`),
  );
  const { viewportRef, viewport, camera, overview, canFocus, toggleOverview } =
    useGuidedImageCamera(
      `${display.id}:${display.image.sha256}:${interactive ? "reading" : "classroom"}`,
      display.image,
      active,
      animateCamera,
    );
  const frame = useGuidedImageTransition(
    `${display.id}:${display.image.sha256}:${display.segmentation.geometryVersion ?? "legacy"}`,
    interactive && animateCamera && overview ? [] : active,
    previous,
    clocked,
    progress,
  );
  // Overview is a transition destination, not a rendering gate. Keep the mask
  // until its painted selection has faded out; reversals resume that frame.
  const focused = !showRegions && frame.highlights.length > 0;
  const videoCamera =
    timeline && !showRegions
      ? guidedImageCameraFrame({
          image: display.image,
          viewport,
          regions: active,
          previousRegions: previous,
          progress: clocked ? progress : 1,
        })
      : camera;
  return (
    <figure
      className="guided-image"
      data-course-display-key={display.id}
      data-presentation={interactive ? "reading" : "classroom"}
    >
      <div
        ref={viewportRef}
        className="guided-image-viewport"
        style={
          interactive ? { aspectRatio: `${width} / ${height}` } : undefined
        }
        data-auto-focus={(interactive && animateCamera) || undefined}
      >
        <svg
          viewBox={
            showRegions
              ? `0 0 ${width} ${height}`
              : `${videoCamera.x} ${videoCamera.y} ${videoCamera.width} ${videoCamera.height}`
          }
          data-camera-zoom={showRegions ? "1.00" : videoCamera.zoom.toFixed(2)}
          role="img"
          aria-label={display.intent.title}
          data-active-regions={active.map((r) => r.id).join(" ")}
        >
          {focused && (
            <defs>
              <filter
                id={`${uid}-feather`}
                filterUnits="userSpaceOnUse"
                x={0}
                y={0}
                width={width}
                height={height}
              >
                <feGaussianBlur
                  stdDeviation={Math.min(width, height) * 0.004}
                />
              </filter>
              <mask
                id={`${uid}-focus`}
                maskUnits="userSpaceOnUse"
                maskContentUnits="userSpaceOnUse"
                x={0}
                y={0}
                width={width}
                height={height}
                style={{ maskType: "alpha" }}
              >
                <rect
                  width={width}
                  height={height}
                  fill="white"
                  opacity={frame.backgroundOpacity}
                />
                {/* Blur the combined selection, so overlapping boxes never draw
                  interior edges. Only the mask softens; text stays sharp. */}
                <g filter={`url(#${uid}-feather)`} fill="white">
                  {frame.highlights.map(({ region, opacity }) => (
                    <g
                      key={region.id}
                      opacity={opacity}
                      data-region-id={region.id}
                    >
                      {region.polygons.map((polygon, i) => (
                        <path
                          key={i}
                          d={imagePolygonPath(polygon, width, height)}
                          fillRule="evenodd"
                        />
                      ))}
                    </g>
                  ))}
                </g>
              </mask>
            </defs>
          )}
          <image
            href={assetUrl(display.image.src)}
            width={width}
            height={height}
            mask={focused ? `url(#${uid}-focus)` : undefined}
          />
          {showRegions &&
            regions.flatMap((region) =>
              region.polygons.map((polygon, i) => (
                <path
                  key={`${region.id}-${i}`}
                  d={imagePolygonPath(polygon, width, height)}
                  className="guided-image-outline"
                  fillRule="evenodd"
                  vectorEffect="non-scaling-stroke"
                  data-region-id={region.id}
                  data-selected={
                    active.some((r) => r.id === region.id) || undefined
                  }
                />
              )),
            )}
        </svg>
      </div>
      {interactive && (
        <figcaption>
          <span>
            {active.length === 1
              ? active.map((r) => r.label).join(" · ")
              : display.intent.title}
          </span>
          {animateCamera &&
            (focused || canFocus || overview || camera.zoom > 1.05) && (
              <CameraToggle overview={overview} onClick={toggleOverview} />
            )}
        </figcaption>
      )}
    </figure>
  );
}

function CameraToggle({
  overview,
  onClick,
}: {
  overview: boolean;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={overview}
      className="guided-image-camera-toggle"
    >
      {t(overview ? "guidedImage.followFocus" : "guidedImage.viewWhole")}
    </button>
  );
}
