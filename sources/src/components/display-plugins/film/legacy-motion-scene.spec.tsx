import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {displayClockAtTick,type DisplayTimelineCue} from '../../../../libs/display/src/index.js';
import type {DisplayRendererProps} from '../../display-runtime/index.js';
import {LegacyMotionScene,legacyMotionArcPath,legacyMotionStage} from './legacy-motion-scene.js';
import {legacyMotionFixture} from './legacy-motion-scene-fixture.js';

jest.mock('./stage.js',()=>({FilmStage:({children}:{children:React.ReactNode})=><div>{children}</div>}));

const timeline:DisplayTimelineCue[]=[
  {id:'first',startTick:200,durationTicks:500,targets:['diagram']},
  {id:'sibling',startTick:800,durationTicks:500,targets:['other']},
  {id:'second',startTick:1200,durationTicks:500,targets:['diagram']},
  {id:'third',startTick:2200,durationTicks:500,targets:['diagram']},
  {id:'hold',startTick:3200,durationTicks:500,targets:['diagram']},
];
function input(tick:number,overrides:Partial<DisplayRendererProps>={}):DisplayRendererProps {
  return {node:{id:'diagram',kind:'physics:motion-scene',version:1,payload:legacyMotionFixture()},clock:displayClockAtTick(tick,60,1000),mode:'video',state:{},updateState:()=>{},children:null,slots:{},resources:{},activeTargets:[],timeline,...overrides};
}
const render=(tick:number)=>renderToStaticMarkup(<LegacyMotionScene {...input(tick)}/>);

test('whole-node narration cues reveal the accepted stages exactly at their boundaries and hold the final stage',()=>{
  const at=(tick:number)=>legacyMotionStage(legacyMotionFixture(),input(tick)).id;
  expect([0,199,200,700,1199].map(at)).toEqual(Array(5).fill('contact_stage'));
  expect(at(1200)).toBe('pull_stage');
  expect(at(2199)).toBe('pull_stage');
  expect(at(2200)).toBe('sources_stage');
  expect(at(999_999)).toBe('sources_stage');
  const before=render(1500);render(3400);render(0);
  expect(render(1500)).toBe(before);
  expect(before).toContain('data-motion-object="pull" data-motion-kind="arrow" data-motion-visible="true"');
  expect(before).toContain('data-motion-object="on_rope" data-motion-kind="arrow" data-motion-visible="false"');
});

test('explicit namespaced stage cues and local host targets take precedence over fallback narration count',()=>{
  const payload=legacyMotionFixture();
  const cues=[...timeline,{id:'explicit',startTick:600,durationTicks:200,targets:['diagram/sources_stage']}];
  expect(legacyMotionStage(payload,input(600,{timeline:cues})).id).toBe('sources_stage');
  expect(legacyMotionStage(payload,input(1500,{timeline:cues})).id).toBe('sources_stage');
  expect(legacyMotionStage(payload,input(1500,{timeline:cues,activeTargets:['diagram/contact_stage']})).id).toBe('contact_stage');
  expect(legacyMotionStage(payload,input(1500,{activeTargets:['other/sources_stage']})).id).toBe('pull_stage');
  const node={...input(0).node,payload:{...payload,activeTargetIds:['sources_stage']}};
  expect(legacyMotionStage(payload,input(0,{node})).id).toBe('sources_stage');
  // The supplied timeline may be unsorted; only narration time determines order.
  expect(legacyMotionStage(payload,input(1500,{timeline:timeline.slice().reverse()})).id).toBe('pull_stage');
});

test('direct SVG keeps top-left rectangles, exact endpoints, original colors, dashed construction lines and all accepted labels',()=>{
  const payload=legacyMotionFixture(),before=JSON.stringify(payload),html=renderToStaticMarkup(<LegacyMotionScene {...input(2500,{node:{...input(0).node,payload}})}/>);
  expect(html).toContain('<rect x="180" y="220" width="140" height="100"');
  expect(html).toContain('<line x1="320" y1="240" x2="428" y2="180" stroke="#dc2626"');
  expect(html).toContain('<line x1="330" y1="235" x2="230" y2="285" stroke="#9333ea"');
  expect(html).toContain('<line x1="120" y1="63.3974596216" x2="120" y2="150"');
  expect(html).toContain('stroke-dasharray="7 5"');
  expect(html).toContain('<circle cx="320" cy="240" r="4"');
  expect(html).toContain('refX="10" refY="5"');
  for(const object of payload.objects)if(object.label)expect(html).toContain(object.label);
  expect(html).toContain(payload.stages[2].label);
  expect(html).toContain(payload.description);
  expect(JSON.stringify(payload)).toBe(before);
});

test('angle arcs use clockwise-positive screen coordinates, including the exact upper semicircle and reverse direction',()=>{
  const base={id:'angle',type:'arc' as const,center:[170,150] as [number,number],radius:30,startAngle:-180,endAngle:0};
  expect(legacyMotionArcPath(base)).toBe('M140 150 A30 30 0 0 1 200 150');
  expect(legacyMotionArcPath({...base,startAngle:0,endAngle:-180})).toBe('M200 150 A30 30 0 0 0 140 150');
  const acute=legacyMotionArcPath({...base,startAngle:-60});
  expect(acute.startsWith('M185 124.019237')).toBe(true);
  expect(acute.endsWith(' A30 30 0 0 1 200 150')).toBe(true);
  const full=legacyMotionArcPath({...base,startAngle:0,endAngle:360});
  expect(full.match(/ A30 30/g)).toHaveLength(2);
});
