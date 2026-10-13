import React from 'react';
import type {DisplayRendererProps,DisplayRenderer} from '../../display-runtime/index.js';
import type {DisplayPluginModule} from '../../../../libs/display/src/types.js';
import {FilmStage} from '../film/stage.js';
import type {MaterialMusicTeaching,MaterialMusic,MusicPlaybackState} from '../../../../libs/domain/src/index.js';
import {MusicDisplay as LegacyMusicDisplay} from '../../course-display/music-display.js';
import {MusicScene} from '../../course-display/teaching/templates/music-scenes.js';
import {MusicTimelineContext} from '../../course-display/music-teaching-display.js';
import {TeachingDisplay} from './teaching.js';
import {displayFocus} from './focus.js';
export function MusicDisplay(props:DisplayRendererProps){
 const {node,clock,mode}=props,focus=displayFocus(props);
 const payload=node.payload as {block:MaterialMusicTeaching|MaterialMusic;music?:MusicPlaybackState;activeTargetIds?:readonly string[];progress?:number;previousActiveTargetIds?:readonly string[]};
 const block=payload.music?.figureId===node.id?{...payload.block,id:node.id}:payload.block;
 return <FilmStage kind={node.kind} designWidth={1080}><div className="display-film-music"><MusicTimelineContext.Provider value={{clocked:mode==='video',music:payload.music,reportRemotionStatus:mode==='video'}}>{block.version===1?<LegacyMusicDisplay block={block} interactive={mode==='interactive'} activeTargetIds={payload.activeTargetIds??focus.activeTargetIds}/>:<MusicScene content={block} interactive={mode==='interactive'} frame={clock.frame} fps={clock.fps} timelineDriven timelineMusic={payload.music} performance={null} activeTargetIds={payload.activeTargetIds??focus.activeTargetIds} narration={{progress:payload.progress??(focus.intervals.length?focus.progress:1),previousTargetIds:payload.previousActiveTargetIds??focus.previousActiveTargetIds}}/>}</MusicTimelineContext.Provider></div></FilmStage>;
}

const module:DisplayPluginModule<DisplayRenderer>={components:{'music:score@1':MusicDisplay,'music:teaching@1':TeachingDisplay}};
export default module;
