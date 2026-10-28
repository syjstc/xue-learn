import {isMotionSceneDisplayPayload,motionSceneComponentSchema,validateMotionScene,type RemotionMotionSceneComponent} from './motion-scene-schema.js';

function fixture():RemotionMotionSceneComponent['props'] {
 return {description:'Move the box and reveal its attached label.',objects:[
  {id:'box',kind:'shape',shape:'rect',x:200,y:250,width:120,height:80},
  {id:'label',kind:'text',anchorId:'box',anchorPort:'top',x:0,y:-24,width:160,height:32,text:'Same box'},
 ],stages:[{id:'move',description:'Move the same box right.',tracks:[{targetId:'box',to:{x:600}}]}]};
}

test('a valid display scene resolves without owning the host narration beats',()=>{
 const payload=fixture();
 expect(isMotionSceneDisplayPayload(payload)).toBe(true);
 expect(isMotionSceneDisplayPayload({...payload,presentation:{beats:[],startTick:96_000,endTick:192_000},activeTargetIds:['box'],previousActiveTargetIds:[],progress:.5})).toBe(true);
 expect(payload.objects[0].x).toBe(200);
});

test('authoring with explicit empty or incomplete beats still rejects unplayed stages',()=>{
 const payload=fixture(),failures:string[]=[];
 validateMotionScene(payload,[],(_path,message)=>failures.push(message));
 expect(failures).toEqual([expect.stringContaining('still missing: move')]);
 const complete:string[]=[];
 validateMotionScene(payload,[{action:'transform',targetIds:['move']}],(_path,message)=>complete.push(message));
 expect(complete).toEqual([]);
});

test.each([
 ['an unknown track target',(props:any)=>props.stages[0].tracks[0].targetId='missing'],
 ['an invalid anchored object',(props:any)=>props.objects[1].anchorId='missing'],
 ['a transform incompatible with its target',(props:any)=>props.stages[0].tracks[0].to={value:2}],
 ['an empty stage',(props:any)=>props.stages[0].tracks=[]],
 ['unsafe formula links',(props:any)=>props.objects[1]={id:'label',kind:'formula',x:500,y:250,width:120,height:32,latex:'\\href{https://example.com}{x}'}],
])('display validation still rejects %s',(_label,mutate)=>{
 const payload=fixture();mutate(payload);
 expect(motionSceneComponentSchema.safeParse({type:'motion-scene.v1',props:payload}).success).toBe(true);
 expect(isMotionSceneDisplayPayload(payload)).toBe(false);
});

test('malformed envelopes and primitive-only historical data require explicit adaptation',()=>{
 expect(isMotionSceneDisplayPayload(null)).toBe(false);
 expect(isMotionSceneDisplayPayload({description:'Old diagram',objects:[{id:'box',type:'rect'}],stages:[{id:'show',visibleIds:['box']}]})).toBe(false);
});
