import type {DisplayNode, DisplayTimelineCue} from '../../../libs/display/src/types.js';
import {compositionPages} from './composition-pages.js';

const leaf=(id:string):DisplayNode=>({id,kind:'general:text',version:1,payload:{text:id}});
const node:DisplayNode={id:'lesson',kind:'general:composition',version:1,payload:{layout:'column'},children:[leaf('quiz'),leaf('answers'),leaf('formula')]};
const cues:DisplayTimelineCue[]=[
  {id:'first',startTick:100,durationTicks:100,targets:['quiz']},
  {id:'second',startTick:300,durationTicks:100,targets:['answers']},
  {id:'third',startTick:500,durationTicks:100,targets:['formula/equation']},
  {id:'return',startTick:700,durationTicks:100,targets:['answers']},
];

test('video follows original narration, holding through gaps and reproducing reverse seeks',()=>{
  const sample=(tick:number)=>compositionPages(node,cues,tick,'video');
  expect([0,100,250,300,500,700,900].map(sample)).toEqual([[0],[0],[0],[1],[2],[1],[1]]);
  sample(900);expect(sample(500)).toEqual([2]);expect(sample(0)).toEqual([0]);
});
test('simultaneous targets stay together and descendant targets select their owning page',()=>{
  expect(compositionPages(node,[...cues,{id:'both',startTick:900,durationTicks:100,targets:['quiz','formula/equation']}],950,'video')).toEqual([0,2]);
  const nested={...node,children:[{...leaf('section'),children:[leaf('quiz')]},leaf('answers'),leaf('formula')]};
  expect(compositionPages(nested,cues,150,'video')).toEqual([0]);
});
test('individually narrated grid examples fill the video viewport and explicit overview cues restore the group',()=>{
  const grid={...node,payload:{layout:'grid',columns:2}};
  expect(compositionPages(grid,cues,300,'video')).toEqual([1]);
  expect(compositionPages(grid,[...cues,{id:'overview',startTick:800,durationTicks:100,targets:['lesson']}],850,'video')).toEqual([0,1,2]);
  expect(compositionPages(grid,cues,500,'interactive')).toBeUndefined();
  expect(compositionPages(grid,cues.slice(0,2),500,'video')).toBeUndefined();
});
test('reading, spatial compositions and incompletely narrated columns retain all their content',()=>{
  expect(compositionPages(node,cues,500,'interactive')).toBeUndefined();
  for(const layout of ['row','overlay'])expect(compositionPages({...node,payload:{layout}},cues,500,'video')).toBeUndefined();
  expect(compositionPages(node,cues.slice(0,2),500,'video')).toBeUndefined();
  expect(compositionPages({...node,slots:{aside:[leaf('context')]}},cues,500,'video')).toBeUndefined();
  expect(compositionPages(node,[],500,'video')).toBeUndefined();
});
