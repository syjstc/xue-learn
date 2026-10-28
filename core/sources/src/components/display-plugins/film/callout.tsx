import React, {useRef} from 'react';
import type {DisplayRendererProps} from '../../display-runtime/index.js';
import type {CourseDisplayBlock} from '../../../../libs/domain/src/index.js';
import {CourseCallout, type CourseCalloutVariant} from '../../course-display/course-callout.js';
import {CourseCalloutBody} from '../../course-display/course-callout-body.js';
import {usePresentationFit} from '../../course-display/presentation-stage.js';
import {FilmStage} from './stage.js';
import {StoryText} from './text.js';
import './callout.css';
import {displayFocus} from '../renderers/focus.js';

const labels: Record<CourseCalloutVariant, string> = {definition: '定义', example: '示例', warning: '注意', tip: '提示'};
const empty: readonly string[] = [];

/** Retains the film's fixed rows, Markdown, moving focus plate and sampled wipe. */
export function CalloutDisplay(props: DisplayRendererProps) {
  const {node}=props,focus=displayFocus(props,'whole');
  const payload = node.payload as {block: CourseDisplayBlock; activeTargetIds?: readonly string[]; previousActiveTargetIds?: readonly string[]; revealedTargetIds?: readonly string[]; previousRevealedTargetIds?: readonly string[]; progress?: number};
  const figure = payload.block;
  const variant = (typeof figure.variant === 'string' && Object.hasOwn(labels, figure.variant) ? figure.variant : 'tip') as CourseCalloutVariant;
  const title = String(figure.title ?? figure.caption ?? '').trim();
  const body = String(figure.body ?? figure.summary ?? figure.caption ?? figure.alt ?? '');
  const viewport = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null);
  usePresentationFit(viewport, canvas, true);
  return <FilmStage kind={node.kind}><div ref={viewport} className="display-film-callout"><div ref={canvas} className="display-film-callout-canvas">
    <CourseCallout presentation="film" variant={variant} label={labels[variant]} title={title ? <StoryText text={title}/> : undefined}
      body={<CourseCalloutBody figure={figure} body={body} presentation="film" reserveSpace clocked animate
        activeTargetIds={payload.activeTargetIds ?? focus.activeTargetIds} previousActiveTargetIds={payload.previousActiveTargetIds ?? focus.previousActiveTargetIds}
        revealedTargetIds={payload.revealedTargetIds ?? (focus.intervals.length?focus.revealedTargetIds:undefined)} previousRevealedTargetIds={payload.previousRevealedTargetIds ?? focus.previousRevealedTargetIds}
        progress={payload.progress ?? (focus.intervals.length?focus.progress:1)}/>}/>
  </div></div></FilmStage>;
}
