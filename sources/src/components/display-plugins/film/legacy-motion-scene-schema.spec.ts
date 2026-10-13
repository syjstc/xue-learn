import {isLegacyMotionScenePayload,legacyMotionScenePayloadSchema,parseLegacyMotionScenePayload} from './legacy-motion-scene-schema.js';
import {legacyMotionFixture} from './legacy-motion-scene-fixture.js';

test('the complete saved primitive dialect validates without modifying any accepted coordinate or label',()=>{
  const payload=legacyMotionFixture(),before=JSON.stringify(payload);
  const host={...payload,presentation:{beats:[]},activeTargetIds:['pull_stage'],previousActiveTargetIds:[],progress:.5};
  expect(legacyMotionScenePayloadSchema.safeParse(payload).success).toBe(true);
  expect(isLegacyMotionScenePayload(host)).toBe(true);
  expect(parseLegacyMotionScenePayload(host)).toEqual(payload);
  expect(JSON.stringify(payload)).toBe(before);
});

test.each([
  ['nonfinite coordinates',(p:any)=>p.objects[0].x=Infinity],
  ['NaN coordinates',(p:any)=>p.objects[0].y=NaN],
  ['coordinates outside the canvas',(p:any)=>p.objects[1].to=[1001,140]],
  ['rectangles extending outside the canvas',(p:any)=>p.objects[0].width=900],
  ['missing rectangle dimensions',(p:any)=>delete p.objects[0].height],
  ['zero length arrows',(p:any)=>p.objects[3].to=p.objects[3].from],
  ['invalid endpoint tuples',(p:any)=>p.objects[1].from=[320,240,0]],
  ['unknown visible references',(p:any)=>p.stages[0].visibleIds.push('missing')],
  ['duplicate object identities',(p:any)=>p.objects[1].id='box'],
  ['duplicate stage identities',(p:any)=>p.stages[1].id=p.stages[0].id],
  ['ambiguous stage and object identities',(p:any)=>p.stages[0].id='box'],
  ['duplicate stage references',(p:any)=>p.stages[0].visibleIds.push('box')],
  ['objects never shown by any stage',(p:any)=>p.stages.forEach((s:any)=>s.visibleIds=s.visibleIds.filter((id:string)=>id!=='angle'))],
  ['CSS resource colors',(p:any)=>p.objects[3].color='url(https://example.com/image.svg)'],
  ['mixed primitive and canonical geometry',(p:any)=>p.objects[0].kind='shape'],
  ['unrecognized primitive fields',(p:any)=>p.objects[0].rotation=40],
  ['zero arc span',(p:any)=>p.objects[6].endAngle=p.objects[6].startAngle],
  ['arc spans greater than a circle',(p:any)=>{p.objects[6].startAngle=-360;p.objects[6].endAngle=360;}],
  ['blank labels',(p:any)=>p.objects[0].label='  '],
  ['oversized stage lists',(p:any)=>p.stages=Array.from({length:9},(_,i)=>({...p.stages[0],id:`stage_${i}`}))],
])('rejects %s before rendering',(_name,mutate)=>{
  const payload=legacyMotionFixture();mutate(payload);
  expect(isLegacyMotionScenePayload(payload)).toBe(false);
});

test('malformed envelopes and canonical motion geometry are not accepted as saved primitives',()=>{
  expect(isLegacyMotionScenePayload(null)).toBe(false);
  expect(isLegacyMotionScenePayload([])).toBe(false);
  const payload=legacyMotionFixture();
  (payload.objects[0] as any)={id:'box',kind:'shape',shape:'rect',x:180,y:220,width:140,height:100};
  expect(isLegacyMotionScenePayload(payload)).toBe(false);
});
