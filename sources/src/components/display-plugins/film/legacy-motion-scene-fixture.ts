import type {LegacyMotionScenePayload} from './legacy-motion-scene-schema.js';

export function legacyMotionFixture():LegacyMotionScenePayload {
  const objects:LegacyMotionScenePayload['objects']=[
    {id:'box',type:'rect',x:180,y:220,width:140,height:100,label:'研究对象：箱子'},
    {id:'rope',type:'line',from:[320,240],to:[500,140],label:'绷紧的绳'},
    {id:'contact',type:'point',position:[320,240],label:'绳—箱连接处'},
    {id:'pull',type:'arrow',from:[320,240],to:[428,180],color:'#dc2626',group:'forces',label:'绳对箱：右上，画在箱的受力图'},
    {id:'on_rope',type:'arrow',from:[330,235],to:[230,285],color:'#9333ea',label:'箱对绳：左下，画在绳的受力图'},
    {id:'drop',type:'line',from:[120,63.3974596216],to:[120,150],dashed:true,label:'垂直辅助线'},
    {id:'angle',type:'arc',center:[170,150],radius:30,startAngle:-120,endAngle:0,label:'θ＝120°'},
  ];
  return {description:'教学示意，非实测。两项作用属于两个不同受力对象。',objects,stages:[
    {id:'contact_stage',label:'先找研究对象与连接处',visibleIds:['box','rope','contact']},
    {id:'pull_stage',label:'在连接处画绳对箱子的拉力',visibleIds:['box','rope','contact','pull']},
    {id:'sources_stage',label:'两项作用，两个受力对象',visibleIds:objects.map(object=>object.id)},
  ]};
}
