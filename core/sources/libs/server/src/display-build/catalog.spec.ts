import {builtinDisplayManifests} from '../../../../src/components/display-plugins/catalog.js';
import {readMaterialVisual} from '../../../domain/src/material-visual.js';
import type {DisplayDocument} from '../../../display/src/types.js';
import {authoredDisplayDocumentIssues} from './catalog.js';

const visual = {type:'visual',kind:'bars',title:'两条请求的 KV cache 占用',unit:'字节',items:[
  {id:'request-a',label:'请求 A',value:70400}, {id:'request-b',label:'请求 B',value:131200},
]};
const document = (block:unknown):DisplayDocument => ({version:1,id:'cache',plugins:[{id:'org.xuelearn.display.general',version:'1.0.0'}],
  root:{id:'vis12',kind:'general:visual',version:1,payload:{block}}});

test('published semantic visuals obey the same contract as the shared renderer',()=>{
  expect(readMaterialVisual(visual)).not.toBeNull();
  expect(authoredDisplayDocumentIssues(document(visual),builtinDisplayManifests)).toEqual([]);
  for(const block of [
    {...visual,type:undefined},
    {...visual,items:{item:{item:visual.items.map(item=>({...item,value:String(item.value)}))}}},
    {...visual,items:visual.items.map(item=>({...item,id:'duplicate'}))},
    {...visual,items:visual.items.map(item=>({...item,value:-1}))},
    {...visual,kind:'process'},
  ]) {
    expect(readMaterialVisual(block)).toBeNull();
    expect(authoredDisplayDocumentIssues(document(block),builtinDisplayManifests).join(';')).toContain('Invalid semantic visual on vis12');
  }
});
