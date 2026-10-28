import {InlineMathText} from "../../markdown/inline-math-text.js";
import React, {useMemo, type CSSProperties} from 'react';
import type {RemotionCodeComponent} from "./types.js";
import type {LessonMotion} from './lesson-motion.js';
import {CourseCodeDisplay} from '../../course-display/course-code.js';
import {classroomCodeTargetId} from '../../../../libs/domain/src/index.js';
import {classroomCodeBoardAdapter, sampleClassroomCodeViewport} from './code-board-sampling.js';
import './code-base.css';
import './code-board.css';

/** Remotion supplies its accepted narration clock to the existing classroom
 * renderer. Source partitions, syntax, board math and source-row measurement
 * share that renderer; video only owns the shell and sampled camera movement. */
export function CodeBoard({props, motion}: {props: RemotionCodeComponent['props']; motion: LessonMotion}) {
  const adapter = useMemo(() => classroomCodeBoardAdapter(props), [props]);
  const focused = props.highlights.find(highlight => motion.targets.includes(highlight.id));
  const elapsedTicks = motion.activeSeconds * 48_000;
  const durationTicks = motion.active?.duration ?? 48_000;
  const lightingTargets = (ids: readonly string[]) => adapter.targets(ids).map(id => id === 'whole' ? id : classroomCodeTargetId(id));
  return <div className="rm-classroom-code" data-code-focus={focused?.id} data-code-surface={props.language === 'text' ? 'text' : 'code'} style={{'--rm-code-cue': motion.progress} as CSSProperties}>
    <div className="rm-classroom-code-frame lp-stage-content">
      <CourseCodeDisplay surface="classroom" block={adapter.block} sourceParts={adapter.parts}
        activeTargetIds={lightingTargets(motion.targets)} previousActiveTargetIds={lightingTargets(motion.previous?.targetIds ?? [])}
        clocked beatEnter={motion.progress}
        sampleClockedScroll={sample => sampleClassroomCodeViewport(sample, elapsedTicks, durationTicks)}/>
    </div>
    <div className="rm-classroom-code-note"><InlineMathText text={focused?.label ?? ""}/></div>
  </div>;
}
