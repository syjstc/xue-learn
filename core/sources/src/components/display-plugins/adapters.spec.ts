import {materialDisplayDocument,derivationDisplayDocument} from './adapters.js';
import {builtinDisplayManifests,builtinDisplayPluginForKind} from './catalog.js';
import {validateDisplayDocument,validateDisplayPayload} from '../../../libs/display/src/validation.js';
import {derivationDisplayTimeline,derivationDisplayDurationTicks,sampleDerivationDisplay} from './derivation-sampling.js';
import type {TeachingDerivationDocumentV1} from '../../../libs/teaching-derivation/src/index.js';
import {conversationPages} from './conversation.js';

it('preserves authored comparison IDs and every side instead of truncating a historical multi-side comparison',()=>{
 const source={type:'compare',id:'comparison',sides:[{id:'slow',label:'Slow',points:[{id:'cost',text:'More time'}]},{id:'fast',label:'Fast',points:['Less time']},{id:'exact',label:'Exact',points:['Complete evidence']}]};
 const document=materialDisplayDocument(source,{activeTargetIds:['exact']});
 expect(document.root.kind).toBe('general:compare');
 expect(document.root.payload).toMatchObject({left:{id:'slow',points:[{id:'cost',text:'More time'}]},right:{id:'fast',points:[{id:'fast-point-0',text:'Less time'}]},sides:source.sides.map(side=>expect.objectContaining({id:side.id})),activeTargetIds:['exact']});
 expect(validateDisplayDocument(document)).toEqual([]);
});
it('composes different domains with exact locks while retaining accepted source code',()=>{
 const document=materialDisplayDocument({type:'stage',id:'two-domains',layout:'split-h',figures:[{type:'code',id:'source',language:'python',code:'x = 1\nx = 1',parts:[{id:'first',text:'x = 1\n'},{id:'second',text:'x = 1'}]},{type:'music',version:2,id:'score',title:'C',layout:'column',notes:[{id:'c',pitches:['C4'],beats:1}],views:[]}]});
 expect(document.root.kind).toBe('general:composition');
 expect(document.root.children?.map(node=>node.kind)).toEqual(['computing:code','music:score']);
 expect((document.root.children?.[0].payload as {code:string}).code).toBe('x = 1\nx = 1');
 expect(document.plugins.map(plugin=>plugin.id).sort()).toEqual(['org.xuelearn.display.computing','org.xuelearn.display.general','org.xuelearn.display.music']);
 expect(validateDisplayDocument(document)).toEqual([]);
});
it('preserves installed third-party document locks and keeps unknown types explicit',()=>{
 const saved={version:1 as const,id:'custom',root:{id:'scope',kind:'teacher:scope',version:2,payload:{frequency:440}},plugins:[{id:'teacher.scope',version:'2.3.1',integrity:'sha256-example'}]};
 expect(materialDisplayDocument({type:'display',document:saved})).toBe(saved);
 expect(materialDisplayDocument({type:'future-kind',id:'future'}).root.kind).toBe('legacy:future-kind');
});
it('keeps image regions scoped to their original stage figure in chat and narration intervals',()=>{
 const source={type:'stage',id:'pictures',layout:'split-h',figures:[{type:'illustration',id:'first',caption:'First',imageUrl:'/first.png'},{type:'illustration',id:'second',caption:'Second',imageUrl:'/second.png'}]};
 const document=materialDisplayDocument(source,{activeTargetIds:['fig:second:image:subject'],previousActiveTargetIds:['fig:first:image:subject'],
  teachingTimeline:{tick:120_000,intervals:[{startTick:0,durationTicks:96_000,targetIds:['fig:first:image:subject']},{startTick:96_000,durationTicks:96_000,targetIds:['fig:second:image:subject']}]}});
 expect(document.root.children![0].payload).toMatchObject({activeTargetIds:[],previousActiveTargetIds:['image:subject'],teachingTimeline:{intervals:[{targetIds:['image:subject']},{targetIds:[]}]}});
 expect(document.root.children![1].payload).toMatchObject({activeTargetIds:['image:subject'],previousActiveTargetIds:[],teachingTimeline:{intervals:[{targetIds:[]},{targetIds:['image:subject']}]}});
});
it('requires ready derivations to contain their prepared document',()=>{
 const component=builtinDisplayPluginForKind('math:derivation')!.components.find(component=>component.kind==='math:derivation')!;
 expect(validateDisplayPayload({title:'Still pending'},component.payloadSchema)).not.toEqual([]);
 expect(builtinDisplayManifests.find(plugin=>plugin.id==='org.xuelearn.display.math')!.builders?.[0].id).toBe('math:derive');
});
it('preserves complete dialogue speakers, authored targets and every character across pages',()=>{
 const turns=[{id:'teacher',speaker:'老师',text:'请解释这一项。'.repeat(35)},{id:'student',speaker:'学生',text:'A complete reply with a supplementary symbol: 𝑥.'}];
 const node=materialDisplayDocument({type:'conversation',id:'dialogue',turns}).root;
 expect(node.kind).toBe('general:conversation');expect(node.targets).toEqual(['teacher','student']);
 const parts=conversationPages(turns).flat();
 turns.forEach(turn=>{expect(parts.filter(part=>part.id===turn.id).map(part=>part.text).join('')).toBe(turn.text);expect(parts.filter(part=>part.id===turn.id).every(part=>part.speaker===turn.speaker)).toBe(true);});
});
const document={schemaVersion:1,id:'derivation',title:'Add one',locale:'en',teachingGoal:'Observe change',givens:[],status:'complete',revision:1,steps:[
 {index:1,board:[],relation:'introduce',justification:'Given',narration:'First inspect the initial expression. Now add one.',focusFormulaKey:'f',cues:[{id:'notice',text:'First inspect the initial expression.',targetIds:['before']},{id:'change',text:'Now add one.',targetIds:['after'],startTransform:true}]},
 {index:2,board:[],relation:'equivalence',justification:'Result',narration:'Inspect the result.',focusFormulaKey:'f',cues:[{id:'result',text:'Inspect the result.',targetIds:['result'],startTransform:true}]},
]} as TeachingDerivationDocumentV1;
it('samples derivation morph only after the authored transform cue and reconstructs reverse seeks',()=>{
 const timeline=derivationDisplayTimeline(document),trigger=timeline[1];
 expect(sampleDerivationDisplay(document,trigger.startTick-1)).toMatchObject({toStep:1,cueId:'notice',progress:0,layoutProgress:0});
 const halfway=sampleDerivationDisplay(document,trigger.startTick+15_360);
 expect(halfway.progress).toBeCloseTo(.5);expect(halfway.layoutProgress).toBe(0);
 sampleDerivationDisplay(document,derivationDisplayDurationTicks(document));
 expect(sampleDerivationDisplay(document,trigger.startTick+15_360)).toEqual(halfway);
 expect(sampleDerivationDisplay(document,derivationDisplayDurationTicks(document))).toMatchObject({toStep:2,progress:1,layoutProgress:1});
 expect(derivationDisplayDocument({document}).root.kind).toBe('math:derivation');
});
