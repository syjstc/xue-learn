import type {DisplayComponentManifest, DisplayPluginManifest} from '../../../libs/display/src/types.js';
import {z} from 'zod';
import {motionSceneComponentSchema} from './film/motion-scene-schema.js';
import {legacyMotionScenePayloadSchema} from './film/legacy-motion-scene-schema.js';

const string = {type: 'string'} as const;
const object = (required: readonly string[], properties: Record<string, unknown> = {}) => ({type: 'object', required, properties});
const array = (items: unknown, minItems = 1) => ({type: 'array', items, minItems});
const label = object(['id', 'label'], {id: string, label: string});
const item = object(['id', 'label'], {id: string, label: string, detail: string});
const point = object(['id', 'text'], {id: string, text: string});
const sampledFields={presentation:z.unknown().optional(),activeTargetIds:z.array(z.string()).optional(),previousActiveTargetIds:z.array(z.string()).optional(),progress:z.number().optional()};
const motionPayloadSchema=z.toJSONSchema(z.union([
  motionSceneComponentSchema.shape.props.extend(sampledFields),
  z.object({...legacyMotionScenePayloadSchema.shape,...sampledFields}).strict(),
])) as Record<string,unknown>;
const component = (kind: string, description: string, payloadSchema: Record<string, unknown>, examples?: readonly unknown[]): DisplayComponentManifest => ({kind, version: 1, description, payloadSchema, examples});
const teaching = (kind: string) => component(kind, 'Remotion-quality domain artwork with semantic operations; the host supplies narration time.', object(['block'], {block: object(['templateId', 'content'], {templateId: string, content: {type: 'object'}})}));
const pack = (domain: string, components: DisplayComponentManifest[], extra: Partial<DisplayPluginManifest> = {}): DisplayPluginManifest => ({apiVersion: 1, id: `org.xuelearn.display.${domain}`, version: '1.0.0', title: `XueLearn ${domain}`, domains: [domain], execution: 'trusted', components, ...extra});

/** Pure serializable metadata. Agents discover these schemas without loading React or executing plugin code. */
export const builtinDisplayManifests: readonly DisplayPluginManifest[] = [
  pack('general', [
    {...component('general:composition', 'Compose loaded domain components in a row, column, grid or layered scene.', object([], {layout: {enum: ['row', 'column', 'grid', 'overlay']}, columns: {type:'number',minimum:1,maximum:6}})), slots: {children:{multiple:true},main:{multiple:true},aside:{multiple:true}}},
    component('general:text', 'A readable text primitive that can be combined with math, music and scientific diagrams.', object(['text'], {text:string,title:string})),
    component('general:callout', 'An accepted Markdown callout with fixed detail rows, numbered facts and sampled narration focus.', object(['block'], {block:object(['type','body'],{type:{const:'callout'},body:string,id:string,title:string})})),
    component('general:conversation', 'A complete dialogue with stable speaker turns and narration focus.', object(['turns'],{title:string,turns:array(object(['id','speaker','text'],{id:string,speaker:string,text:string}))})),
    component('general:title', 'Cinematic opening or conclusion with deterministic entrance animation.', object(['headline','keywords'],{headline:string,eyebrow:string,subtitle:string,keywords:array(label,0)})),
    component('general:cards', 'Animated semantic cards with stable focus targets.', object(['items','layout'], {layout:{enum:['grid','stack']},items:array(item)})),
    component('general:compare', 'Two animated comparison panels.', object(['left','right'],{left:object(['id','label','points'],{id:string,label:string,points:array(point,0)}),right:object(['id','label','points'],{id:string,label:string,points:array(point,0)})})),
    component('general:process', 'A directed or cyclic process with sampled progress and per-step explanations.', object(['steps','direction'],{steps:array(item),direction:{enum:['linear','cycle']}})),
    component('general:concept-network', 'A semantic node network with animated connections.', object(['nodes','edges'],{nodes:array(item),edges:array(object(['id','from','to'],{id:string,from:string,to:string,label:string}),0)})),
    teaching('general:teaching'),
    component('general:visual','A structured semantic visual with deterministic host sampling.',object(['block'],{block:{type:'object'}})),
  ]),
  pack('math', [
    component('math:formula', 'Animated multi-step equations and synchronized explanation; equations are LaTeX data, not code.', object(['equations','notes'],{equations:array(object(['id','latex'],{id:string,latex:string,label:string})),notes:array(point,0)}),[{equations:[{id:'energy',latex:'E=mc^2',label:'Energy'}],notes:[]}]),
    component('math:chart', 'Deterministic bar, line or donut chart from explicit numeric evidence.',object(['chart','unit','categories','series'],{chart:{enum:['bar','line','donut']},unit:string,categories:array(label),series:array(object(['id','label','values'],{id:string,label:string,values:array({type:'number'})}))})),
    component('math:derivation', 'A prepared formal teaching derivation with morphing expressions, proof steps and companion visuals. Build asynchronously before rendering.',object(['document'], {document:{type:'object'},derived:{type:'object'},title:string,requirement:string,locale:string})),
    component('math:formal-derivation', 'Preserved formal-expression derivations on the shared animated formula board.',object(['document'],{document:{type:'object'}})),
    teaching('math:teaching'),
  ],{builders:[{id:'math:derive',description:'Generate and validate a complete derivation asynchronously, then commit a ready display artifact.',inputSchema:object(['requirement'],{title:string,requirement:string,locale:string}),outputKind:'math:derivation',outputVersion:1}]}),
  pack('music', [component('music:score','A complete playable score, harmony or rhythm display with host-owned playback time.',object(['block'],{block:object(['version'],{version:{type:'number'}})})),teaching('music:teaching')]),
  pack('physics', [
    teaching('physics:teaching'),
    component('physics:presentation','Preserved deterministic concept-network and occlusion experiment.',object(['scenePlan','timeline'],{scenePlan:{type:'object'},timeline:{type:'object'}})),
    component('physics:spatial-assembly','Deterministic 3D geometry assembly, rendered as vector graphics.',object(['layout','parts','caption'],{layout:{enum:['row','stack','orbit']},parts:array(object(['id','label','primitive','tone'],{id:string,label:string,primitive:{enum:['box','sphere','cylinder','cone']},tone:{enum:['primary','secondary','accent','muted']}})),caption:string})),
    component('physics:motion-scene','Advanced vector animation with mathematical text, object tracks, camera motion and ordered stages. New authoring uses the canonical kind/track dialect; the type/visibleIds dialect is read compatibility only. Declare object and stage IDs in node.targets. Each narration cue uses nodeId/stageId to execute its stage; nodeId/objectId focuses an object. Include those cues in document.timeline for standalone playback. presentation and focus sampling fields belong to the host.',motionPayloadSchema),
    component('physics:occlusion-lab','A reproducible observation and cutaway experiment.',object(['cells','wall','moveBy','cases','stages'],{cells:{type:'number',minimum:1},wall:{type:'object'},moveBy:{type:'number'},cases:{type:'array',minItems:1},stages:{type:'array',minItems:1}})),
  ]),
  pack('computing', [
    component('computing:code','Syntax-aware animated code focus that preserves accepted source lines.',object(['code','language','highlights'],{code:string,language:string,highlights:array(object(['id','label','startLine','endLine'],{id:string,label:string,startLine:{type:'number',minimum:1},endLine:{type:'number',minimum:1}}),0)})),
    component('computing:evaluation-lab','Run identical cases through explicit evaluation results and animate the evidence.',object(['caption','cases','runs'],{caption:string,cases:array(label),runs:{type:'array',minItems:1}})),
  ]),
  pack('media', [
    component('media:image','An immutable instructional image with sampled camera motion and optional semantic region focus.',object(['id','alt','caption'],{id:string,alt:string,caption:string,src:string,motion:{enum:['still','push-in','pull-out','pan-left','pan-right']}})),
    component('media:lottie','A curated deterministic motion graphic preset.',object(['preset','items','caption'],{preset:{enum:['signal-flow','orbit-cycle','balance-shift']},items:array(item),caption:string})),
  ]),
];

export const builtinDisplayComponentKinds = builtinDisplayManifests.flatMap(manifest => manifest.components.map(component => component.kind));
export const builtinDisplayPluginForKind = (kind: string) => builtinDisplayManifests.find(manifest => manifest.components.some(component => component.kind === kind));
