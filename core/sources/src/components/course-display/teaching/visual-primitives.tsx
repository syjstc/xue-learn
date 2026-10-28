import React from "react";
import type {VisualTeachingProps, MaterialTeachingSample} from "../../../../libs/domain/src/index.js";
import {visualMotion} from "./visual-motion.js";
import {VisualDiagrams} from "./visual-diagrams.js";
import {VisualQuantities} from "./visual-quantities.js";

export function VisualPrimitives({props, frame, fps, sample, motionSeconds}: {
  props: VisualTeachingProps; frame: number; fps: number; sample?: MaterialTeachingSample; motionSeconds?: number;
}) {
  const motion=visualMotion(props,frame,fps,sample,motionSeconds);
  return ["visual-timeline","visual-cycle","visual-decision","visual-network","visual-interval","visual-hierarchy"].includes(props.templateId)
    ? <VisualDiagrams props={props} motion={motion}/>
    : <VisualQuantities props={props} motion={motion}/>;
}
