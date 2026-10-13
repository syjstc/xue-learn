import {legacyMotionViewBox} from './legacy-motion-scene-layout.js';
import {legacyMotionFixture} from './legacy-motion-scene-fixture.js';
import type {LegacyMotionPrimitive} from './legacy-motion-scene-schema.js';

const frame=(objects:LegacyMotionPrimitive[])=>legacyMotionViewBox({...legacyMotionFixture(),objects}).split(' ').map(Number);

test('tight framing removes empty authored canvas and includes every stage without changing geometry',()=>{
  const payload=legacyMotionFixture(),before=JSON.stringify(payload);
  const initial=legacyMotionViewBox(payload);
  expect(legacyMotionViewBox({...payload,stages:payload.stages.slice().reverse()})).toBe(initial);
  expect(Number(initial.split(' ')[2])).toBeLessThan(1000);
  expect(JSON.stringify(payload)).toBe(before);
  expect(frame([{id:'axis',type:'line',from:[40,150],to:[320,150]}])).toEqual([17.599999999999994,100,324.8,100]);
});
test('arc bounds include swept cardinal extrema for clockwise, reverse and full-circle paths',()=>{
  const arc={id:'angle',type:'arc' as const,center:[170,150] as [number,number],radius:30,startAngle:-180,endAngle:0};
  expect(frame([arc])).toEqual([110,85,120,100]);
  expect(frame([{...arc,startAngle:0,endAngle:-180}])).toEqual(frame([arc]));
  expect(frame([{...arc,startAngle:0,endAngle:360}])).toEqual([110,100,120,100]);
  expect(frame([{...arc,startAngle:-60}])[1]).toBeCloseTo(87.00961894323342);
});
