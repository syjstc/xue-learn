import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {DisplayRendererProps} from '../../display-runtime/index.js';
import {createDisplayClock} from '../../../../libs/display/src/clock.js';
import physicsModule,{MotionSceneDisplay} from './physics.js';

jest.mock('../film/stage.js',()=>({FilmStage:({children}:any)=>children}));
jest.mock('../film/special-scenes.js',()=>({SpecialBoard:()=>null}));
jest.mock('../film/spatial-assembly.js',()=>({SpatialAssembly:()=>null}));
jest.mock('../film/motion-scene.js',()=>({MotionScene:()=> <div data-dialect="canonical"/>}));
jest.mock('../film/occlusion-lab.js',()=>({OcclusionLab:()=>null}));
jest.mock('../film/legacy-motion-scene.js',()=>({LegacyMotionScene:()=> <div data-dialect="legacy"/>}));
jest.mock('./teaching.js',()=>({TeachingDisplay:()=>null}));
jest.mock('./animated.js',()=>({createAnimatedDisplay:(type:string,render:any)=>(props:any)=>render({component:{type,props:props.node.payload}})}));

const canonical={description:'Move the square.',objects:[
 {id:'box',kind:'shape',shape:'rect',x:200,y:250,width:120,height:80},
 {id:'label',kind:'text',x:200,y:150,width:160,height:32,text:'Box'},
],stages:[{id:'move',description:'Move right.',tracks:[{targetId:'box',to:{x:600}}]}]};
const legacy={description:'Reveal the square and arrow.',objects:[
 {id:'box',type:'rect',x:180,y:220,width:140,height:100,label:'Box'},
 {id:'pull',type:'arrow',from:[320,240],to:[428,180],label:'Pull'},
],stages:[{id:'show',label:'Show both.',visibleIds:['box','pull']}]};
const accepts=physicsModule.validators!['physics:motion-scene@1']!;
const render=(payload:unknown)=>renderToStaticMarkup(<MotionSceneDisplay {...({node:{id:'scene',kind:'physics:motion-scene',version:1,payload},clock:createDisplayClock(0),mode:'video'} as DisplayRendererProps)}/>);

test('the physics plugin accepts both complete dialects and dispatches each to its matching renderer',()=>{
 expect(accepts(canonical)).toBe(true);
 expect(accepts(legacy)).toBe(true);
 expect(render(canonical)).toContain('data-dialect="canonical"');
 expect(render(legacy)).toContain('data-dialect="legacy"');
});

test('malformed data cannot pass by mixing the canonical and legacy dialects',()=>{
 expect(accepts({...legacy,objects:[legacy.objects[0],canonical.objects[1]]})).toBe(false);
 expect(accepts({...legacy,stages:[{...legacy.stages[0],visibleIds:['missing']}]})).toBe(false);
 expect(accepts({...canonical,stages:[{...canonical.stages[0],tracks:[{targetId:'missing',to:{x:600}}]}]})).toBe(false);
});
