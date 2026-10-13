import React from 'react';
import type {DisplayRendererProps,DisplayRenderer} from '../../display-runtime/index.js';
import type {DisplayPluginModule} from '../../../../libs/display/src/types.js';
import {FilmStage} from '../film/stage.js';
import {readMaterialVisual} from '../../../../libs/domain/src/material-visual.js';
import {AnimatedChart} from '../film/animated-chart.js';
import {StoryText} from '../film/text.js';
import {CalloutDisplay} from '../film/callout.js';
import {GeneralBoard} from '../film/general-board.js';
import {conversationPages,type ConversationTurn} from '../conversation.js';
import {createAnimatedDisplay} from './animated.js';
import {TeachingDisplay} from './teaching.js';
import {displayFocus} from './focus.js';
import {compositionPages} from '../composition-pages.js';
export function CompositionDisplay({node,children,slots,timeline,clock,mode}:DisplayRendererProps){
 const payload=node.payload as {layout?:string;columns?:number};
 const pages=compositionPages(node,timeline,clock.tick,mode);
 const visible=pages?React.Children.toArray(children).filter((_,index)=>pages.includes(index)):children;
 const columns=pages?Math.min(pages.length,payload.columns??2):payload.columns??(payload.layout==='row'?React.Children.count(visible)||1:2);
 return <div className="display-film-composition" data-display-pages={pages?.map(index=>node.children![index].id).join(' ')} style={{gridTemplateColumns:payload.layout==='column'?'1fr':`repeat(${columns},minmax(0,1fr))`,...(payload.layout==='overlay'?{display:'grid'}:{})}}>{payload.layout==='overlay'?React.Children.map(visible,child=><div style={{gridArea:'1/1',minWidth:0,minHeight:0}}>{child}</div>):visible}{slots.main}{slots.aside}</div>;
}
const VisualProcess=createAnimatedDisplay('process.v1',({component,motion})=><GeneralBoard component={component} motion={motion}/>);
const VisualLayers=createAnimatedDisplay('cards.v1',({component,motion})=><GeneralBoard component={component} motion={motion}/>);
const VisualBars=createAnimatedDisplay('animated-chart.v1',({component,motion})=><AnimatedChart props={component.props} motion={motion}/>);
/** Accepted semantic visuals use the same animated boards as native video authoring. */
export function VisualDisplay(props:DisplayRendererProps){
 const payload=props.node.payload as Record<string,unknown>,block=readMaterialVisual(payload.block);
 if(!block)throw new Error('The semantic visual is invalid');
 const focus=displayFocus(props),authored=payload.activeTargetIds as readonly string[]|undefined;
 const targets=(authored??focus.activeTargetIds).map(id=>id.startsWith(`visual:${block.id||'display'}:`)?id.slice(`visual:${block.id||'display'}:`.length):id);
 const common={...payload,activeTargetIds:targets,progress:payload.progress??focus.progress,title:block.title};
 const items=block.items.map(item=>({...item,detail:item.detail??''}));
 const translated=block.kind==='bars'?{...common,chart:'bar',unit:block.unit??'',categories:items,series:[{id:`${props.node.id}-values`,label:block.title,values:items.map(item=>item.value!)}]}:block.kind==='layers'?{...common,layout:'stack',items}:{...common,direction:block.kind==='cycle'?'cycle':'linear',steps:items};
 const Renderer=block.kind==='bars'?VisualBars:block.kind==='layers'?VisualLayers:VisualProcess;
 return <Renderer {...props} node={{...props.node,payload:translated}}/>;
}
export function TextDisplay({node}:DisplayRendererProps){const payload=node.payload as {title?:string;text:string};return <FilmStage kind={node.kind}><article className="display-film-text rm-panel">{payload.title&&<h2><StoryText text={payload.title}/></h2>}<p><StoryText text={payload.text}/></p></article></FilmStage>;}
export function ConversationDisplay(props:DisplayRendererProps){
 const {node,clock,timeline,mode,state,updateState}=props,focus=displayFocus(props);
 const payload=node.payload as {title?:string;turns:ConversationTurn[];activeTargetIds?:readonly string[];presentation?:{startTick?:number}};
 const targets=payload.activeTargetIds??focus.activeTargetIds;
 const active=payload.turns.find(turn=>targets.includes(turn.id));
 const pages=conversationPages(payload.turns);
 const cue=timeline.filter(cue=>cue.startTick<=clock.tick&&cue.targets.some(target=>target.startsWith(`${node.id}/`))).at(-1);
 const focused=pages.flatMap((page,index)=>page.some(turn=>turn.id===active?.id)?[index]:[]);
 const progress=cue?Math.max(0,Math.min(.999,(clock.tick-cue.startTick)/cue.durationTicks)):0;
 const seconds=Math.max(0,clock.timeSeconds-(payload.presentation?.startTick??0)/48_000);
 const automatic=focused.length?focused[Math.floor(progress*focused.length)]:Math.min(pages.length-1,Math.floor(seconds/8));
 const page=mode==='interactive'&&typeof state.page==='number'?Math.max(0,Math.min(pages.length-1,state.page)):automatic;
 return <FilmStage kind={node.kind}><article className="display-film-conversation"><header><h2><StoryText text={payload.title??''}/></h2><span>{page+1} / {pages.length}</span></header><div>{pages[page].map((turn,index)=><section key={`${turn.id}:${turn.part}`} data-conversation-turn={turn.id} className="rm-panel" style={{marginLeft:index%2?120:0,marginRight:index%2?0:120,opacity:!active||active.id===turn.id?1:.48}}><strong><StoryText text={turn.speaker}/>{turn.parts>1&&<small> {turn.part+1}/{turn.parts}</small>}</strong><p><StoryText text={turn.text}/></p></section>)}</div>{mode==='interactive'&&pages.length>1&&<nav aria-label="对话翻页"><button disabled={page===0} onClick={()=>updateState({page:page-1})}>上一页</button><button disabled={page===pages.length-1} onClick={()=>updateState({page:page+1})}>下一页</button></nav>}</article></FilmStage>;
}


const module:DisplayPluginModule<DisplayRenderer>={components:{
 'general:title@1':createAnimatedDisplay('title.v1',({component,motion})=><GeneralBoard component={component} motion={motion}/>),
 'general:cards@1':createAnimatedDisplay('cards.v1',({component,motion})=><GeneralBoard component={component} motion={motion}/>),
 'general:compare@1':createAnimatedDisplay('compare.v1',({component,motion})=><GeneralBoard component={component} motion={motion}/>),
 'general:process@1':createAnimatedDisplay('process.v1',({component,motion})=><GeneralBoard component={component} motion={motion}/>),
 'general:concept-network@1':createAnimatedDisplay('concept-network.v1',({component,motion})=><GeneralBoard component={component} motion={motion}/>),
 'general:teaching@1':TeachingDisplay,'general:composition@1':CompositionDisplay,'general:text@1':TextDisplay,
 'general:callout@1':CalloutDisplay,'general:visual@1':VisualDisplay,'general:conversation@1':ConversationDisplay,
},validators:{'general:visual@1':value=>!!readMaterialVisual((value as {block?:unknown}).block)}};export default module;
