import {DisplayPlaceholder} from '../../display-runtime/index.js';
import {InlineMathText} from "../../markdown/inline-math-text.js";
import { useId, useState } from 'react';
import type { CompiledVideoTimelineV1 } from './timeline.js';
import type { RemotionImageComponent, RemotionLessonSceneV1 } from "./types.js";
import type { LessonMotion } from './lesson-motion.js';
import { StoryText } from './text.js';
import {imagePolygonPath} from "../../../../libs/domain/src/guided-image.js";
import {sampleImageBoard} from './image-board-sampling.js';
import {GuidedImageFocusOutline} from '../../course-display/guided-image-focus-outline.js';
import './image-board.css';

/** Camera motion is sampled from absolute scene time, including reverse seek. */
export function ImageBoard({ props, motion, scene, timeline, tick }: {
  props: RemotionImageComponent['props']; motion: LessonMotion; scene: RemotionLessonSceneV1;
  timeline: CompiledVideoTimelineV1; tick: number;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const uid = useId().replace(/:/g, '');
  const guided = sampleImageBoard(scene, timeline, tick);
  const interval = timeline.scenes.find(entry => entry.id === scene.id);
  const progress = interval ? Math.max(0, Math.min(1, (tick - interval.startTick) / Math.max(1, (interval.endTick - interval.startTick)))) : 0;
  const mode = props.motion ?? 'push-in';
  const pan = mode === 'pan-left' ? 1 - 2 * progress : mode === 'pan-right' ? 2 * progress - 1 : 0;
  const scale = mode === 'push-in' ? 1 + .05 * progress : mode === 'pull-out' ? 1.05 - .05 * progress : mode === 'pan-left' || mode === 'pan-right' ? 1.05 : 1;
  if(status==='error'||!props.src)return <DisplayPlaceholder failure={{reason:'resource-error',message:'The instructional image failed to load',kind:'media:image'}}/>;
  return <figure className="rm-film-image" data-animation-component="image.v1" data-remotion-resource-status={props.src ? status : 'error'}>
    <div className="rm-film-image-window" style={{ opacity: guided ? motion.entrance : motion.opacity(props.id) }}>
      {props.src && guided ? <svg className="rm-film-image-guided" role="img" aria-label={props.alt}
        viewBox={`${guided.camera.x} ${guided.camera.y} ${guided.camera.width} ${guided.camera.height}`}
        data-camera-zoom={guided.camera.zoom.toFixed(3)} data-active-regions={guided.targets.join(' ')}>
        <defs>
          <filter id={`${uid}-feather`} filterUnits="userSpaceOnUse" x={0} y={0} width={guided.image.width} height={guided.image.height}>
            <feGaussianBlur stdDeviation={Math.min(guided.image.width, guided.image.height) * .004}/>
          </filter>
          <mask id={`${uid}-focus`} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x={0} y={0}
            width={guided.image.width} height={guided.image.height} style={{maskType: 'alpha'}}>
            <rect width={guided.image.width} height={guided.image.height} fill="white" opacity={guided.frame.backgroundOpacity}/>
            <g fill="white" filter={`url(#${uid}-feather)`}>
              {guided.frame.highlights.map(({region, opacity}) => <g key={region.id} opacity={opacity}>
                {region.polygons.map((polygon, index) => <path key={index} d={imagePolygonPath(polygon, guided.image.width, guided.image.height)} fillRule="evenodd"/>)}</g>)}
            </g>
          </mask>
        </defs>
        <image href={props.src} width={guided.image.width} height={guided.image.height} mask={`url(#${uid}-focus)`}
          onLoad={() => setStatus('ready')} onError={() => setStatus('error')}/>
        <GuidedImageFocusOutline frame={guided.frame} width={guided.image.width} height={guided.image.height}/>
      </svg> : props.src ? <img src={props.src} alt={props.alt} onLoad={() => setStatus('ready')} onError={() => setStatus('error')}
        style={{ transform: `translateX(${pan * 1.5}%) scale(${scale})` }}/> : <span>Image asset unavailable</span>}
    </div>
    <figcaption><StoryText text={props.caption}/>{guided?.labels.length ? <span className="rm-film-image-subject"><InlineMathText text={guided.labels.join(' · ')}/></span> : null}</figcaption>
  </figure>;
}
