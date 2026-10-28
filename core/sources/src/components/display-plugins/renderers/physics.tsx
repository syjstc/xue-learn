import React from 'react';
import type {DisplayRendererProps,DisplayRenderer} from '../../display-runtime/index.js';
import type {DisplayPluginModule} from '../../../../libs/display/src/types.js';
import {FilmStage} from '../film/stage.js';
import {SpecialBoard} from '../film/special-scenes.js';
import {SpatialAssembly} from '../film/spatial-assembly.js';
import {MotionScene} from '../film/motion-scene.js';
import {OcclusionLab} from '../film/occlusion-lab.js';
import {isMotionSceneDisplayPayload} from '../film/motion-scene-schema.js';
import {isLegacyMotionScenePayload} from '../film/legacy-motion-scene-schema.js';
import {LegacyMotionScene} from '../film/legacy-motion-scene.js';
import {createAnimatedDisplay} from './animated.js';
import {TeachingDisplay} from './teaching.js';
export function SpecialDisplay({node,clock}:DisplayRendererProps){const p=node.payload as Omit<React.ComponentProps<typeof SpecialBoard>,'tick'>;return <FilmStage kind={node.kind}><SpecialBoard {...p} tick={Math.round(clock.timeSeconds*48_000)}/></FilmStage>;}
const CanonicalMotionScene=createAnimatedDisplay('motion-scene.v1',({component,...context})=><MotionScene props={component.props} {...context}/>);
export function MotionSceneDisplay(props:DisplayRendererProps){return isLegacyMotionScenePayload(props.node.payload)?<LegacyMotionScene {...props}/>:<CanonicalMotionScene {...props}/>;}

const physicsModule:DisplayPluginModule<DisplayRenderer>={components:{
 'physics:spatial-assembly@1':createAnimatedDisplay('spatial-assembly.v1',({component,motion})=><SpatialAssembly props={component.props} motion={motion}/>),
 'physics:motion-scene@1':MotionSceneDisplay,
 'physics:occlusion-lab@1':createAnimatedDisplay('occlusion-lab.v1',({component,...context})=><OcclusionLab props={component.props} {...context}/>),
 'physics:teaching@1':TeachingDisplay,'physics:presentation@1':SpecialDisplay,
},validators:{'physics:motion-scene@1':value=>isMotionSceneDisplayPayload(value)||isLegacyMotionScenePayload(value)}};
export default physicsModule;
