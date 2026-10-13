import {z} from 'zod';

const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const text=(n:number)=>z.string().min(1).max(n).regex(/\S/);
const coordinate=z.number().min(-2000).max(3000);
const point=z.object({x:coordinate,y:coordinate}).strict();
const tone=z.enum(['primary','secondary','positive','caution','ink','muted']);
const pose={x:coordinate,y:coordinate,rotation:z.number().min(-720).max(720).optional(),scale:z.number().min(.1).max(4).optional(),opacity:z.number().min(0).max(1).optional()};
const common={id,parentId:id.optional(),clipId:id.optional(),...pose,tone:tone.optional()};
const dimensions={width:z.number().min(4).max(1000),height:z.number().min(4).max(500)};
const textBox={width:z.number().min(40).max(800),height:z.number().min(24).max(180),size:z.enum(['label','body','heading']).optional(),align:z.enum(['left','center','right']).optional()};
const paint={fill:z.enum(['solid','soft','none']).optional(),strokeWidth:z.number().min(0).max(8).optional()};
const port=z.enum(['left','right','top','bottom','center']);
const labelAnchor={anchorId:id.optional(),anchorPort:port.optional()};

/** A composable display list. All coordinates live in a fixed 1000 x 500
 * teaching canvas, never page CSS. Colours and type roles are host-owned. */
const object=z.discriminatedUnion('kind',[
  z.object({...common,kind:z.literal('group')}).strict(),
  z.object({...common,kind:z.literal('shape'),shape:z.enum(['rect','ellipse','polygon']),...dimensions,...paint,
    points:z.array(point).min(3).max(32).optional(),maskOnly:z.boolean().optional()}).strict(),
  z.object({...common,kind:z.literal('path'),points:z.array(point).min(2).max(48),closed:z.boolean().optional(),arrow:z.boolean().optional(),draw:z.number().min(0).max(1).optional(),...paint}).strict(),
  z.object({...common,kind:z.literal('link'),from:id,to:id,fromPort:port.optional(),toPort:port.optional(),bend:z.number().min(-300).max(300).optional(),arrow:z.boolean().optional(),draw:z.number().min(0).max(1).optional(),strokeWidth:z.number().min(1).max(8).optional()}).strict(),
  z.object({...common,...labelAnchor,kind:z.literal('text'),text:text(80),...textBox}).strict(),
  z.object({...common,...labelAnchor,kind:z.literal('formula'),latex:text(400),...textBox}).strict(),
  z.object({...common,...labelAnchor,kind:z.literal('number'),value:z.number().min(-1e9).max(1e9),decimals:z.number().int().min(0).max(3).optional(),prefix:z.string().max(8).optional(),suffix:z.string().max(8).optional(),...textBox}).strict(),
]);
const patch=z.object({
  x:coordinate.optional(),y:coordinate.optional(),rotation:pose.rotation,scale:pose.scale,opacity:pose.opacity,
  tone:tone.optional(),width:dimensions.width.optional(),height:dimensions.height.optional(),
  draw:z.number().min(0).max(1).optional(),value:z.number().min(-1e9).max(1e9).optional(),
  text:text(80).optional(),latex:text(400).optional(),points:z.array(point).min(2).max(48).optional(),
}).strict();
const camera=z.object({x:z.number().min(0).max(1000),y:z.number().min(0).max(500),zoom:z.number().min(.7).max(2.5)}).strict();

export const motionSceneComponentSchema=z.object({type:z.literal('motion-scene.v1'),props:z.object({
  description:text(160),
  objects:z.array(object).min(2).max(40),
  stages:z.array(z.object({
    id,description:text(120),pace:z.enum(['quick','measured','narration']).optional(),camera:camera.optional(),
    tracks:z.array(z.object({
      targetId:id,to:patch,start:z.number().min(0).max(.9).optional(),end:z.number().min(.1).max(1).optional(),
      easing:z.enum(['smooth','linear','spring']).optional(),via:z.array(point).min(1).max(8).optional(),
    }).strict()).max(40),
  }).strict()).min(1).max(8),
}).strict()}).strict();

export type RemotionMotionSceneComponent=z.infer<typeof motionSceneComponentSchema>;
export type MotionObject=RemotionMotionSceneComponent['props']['objects'][number];
export type MotionStage=RemotionMotionSceneComponent['props']['stages'][number];
export type MotionPatch=MotionStage['tracks'][number]['to'];

export function validateMotionScene(
  props:RemotionMotionSceneComponent['props'],
  beats:readonly {action:string;targetIds:readonly string[]}[]|undefined,
  issue:(path:(string|number)[],message:string)=>void,
) {
  const objects=new Map(props.objects.map(o=>[o.id,o]));
  const stages=new Map(props.stages.map((s,i)=>[s.id,i]));
  const fail=(path:(string|number)[],message:string)=>issue(['component','props',...path],message);
  const unsafeLatex=(latex:string)=>/\\(?:href|url|includegraphics|html\w*)\b/i.test(latex);
  props.objects.forEach((o,i)=>{
    const p=['objects',i];
    if(o.parentId && objects.get(o.parentId)?.kind!=='group') fail(p,'parentId must name a group in this scene');
    if('anchorId' in o&&o.anchorId) {
      if(!objects.has(o.anchorId)||o.anchorId===o.id||objects.get(o.anchorId)?.kind==='link')fail(p,'anchorId must reference another non-link object');
      if(o.parentId)fail(p,'An anchored label uses a world anchor; omit parentId');
    }
    if('anchorPort' in o&&o.anchorPort&&!o.anchorId)fail(p,'anchorPort needs anchorId');
    const chain=new Set([o.id]);let parent=o.parentId||('anchorId' in o?o.anchorId:undefined);
    while(parent && objects.has(parent)) {
      if(chain.has(parent)) {fail(p,'Groups cannot contain a parent cycle');break;}
      chain.add(parent);const ancestor=objects.get(parent)!;parent=ancestor.parentId||('anchorId' in ancestor?ancestor.anchorId:undefined);
    }
    if(chain.size>6) fail(p,'Use at most six group levels');
    if(o.clipId && objects.get(o.clipId)?.kind!=='shape') fail(p,'clipId must name a shape mask');
    if(o.kind==='shape' && o.shape==='polygon' && !o.points) fail(p,'A polygon needs local points relative to its center');
    if(o.kind==='shape' && o.shape!=='polygon' && o.points) fail(p,'Only polygon shapes accept points');
    if(o.kind==='formula' && unsafeLatex(o.latex)) fail(p,'Formula cannot embed links, images or HTML');
    if(o.kind==='link') {
      if(!objects.has(o.from)||!objects.has(o.to)||o.from===o.to||[o.from,o.to].some(key=>objects.get(key)?.kind==='link')) fail(p,'Links need distinct non-link objects');
      if(o.parentId || o.x!==0 || o.y!==0 || (o.rotation??0)!==0 || (o.scale??1)!==1) fail(p,'Links use world endpoints: x/y=0, no parent, rotation or scale');
    }
  });
  props.stages.forEach((stage,i)=>{
    const changed=new Set<string>();
    if(!stage.tracks.length && !stage.camera) fail(['stages',i],'A stage needs an actual object or camera change');
    stage.tracks.forEach((track,j)=>{
      const p=['stages',i,'tracks',j],o=objects.get(track.targetId);
      if(!o) {fail(p,'Unknown motion target');return;}
      if(changed.has(o.id)) fail(p,'One track per object per stage; combine its properties');
      changed.add(o.id);
      if((track.start??0)>=(track.end??1)) fail(p,'Track end must be after start');
      if(!Object.keys(track.to).length) fail(p,'Track must change a property');
      if(track.via && (track.to.x===undefined || track.to.y===undefined)) fail(p,'A movement with waypoints needs a final x and y');
      for(const key of Object.keys(track.to)) {
        const allowed=['x','y','rotation','scale','opacity','tone'].includes(key)
          || ['width','height'].includes(key) && ['shape'].includes(o.kind)
          || key==='draw' && ['path','link'].includes(o.kind)
          || key==='value' && o.kind==='number'
          || key==='text' && o.kind==='text'
          || key==='latex' && o.kind==='formula'
          || key==='points' && (o.kind==='path'||o.kind==='shape'&&o.shape==='polygon');
        if(!allowed) fail(p,`${key} cannot animate a ${o.kind} object`);
        if(o.kind==='link' && ['x','y','rotation','scale'].includes(key)) fail(p,'Move linked objects instead of translating their world-space link');
      }
      if(track.to.points && 'points' in o && track.to.points.length!==o.points?.length) fail(p,'A point morph preserves the number and identity of vertices');
      if(track.to.latex && unsafeLatex(track.to.latex)) fail(p,'Formula cannot embed links, images or HTML');
    });
  });
  // Display payloads are sampled by their host and do not own narration beats.
  // Authoring callers still supply beats and must play every stage in order.
  if(beats===undefined)return;
  let last=-1;
  beats.forEach((beat,i)=>{
    if(beat.action==='transform') {
      const next=stages.get(beat.targetIds[0]);
      if(beat.targetIds.length!==1 || next===undefined) issue(['beats',i],'transform requires exactly one stage id');
      else if(next<last || next>last+1) issue(['beats',i],`Play motion stages in order: use transform with targetIds=["${props.stages[last+1]?.id??props.stages[last]?.id}"] before "${beat.targetIds[0]}". focus/overview never execute a stage.`);
      else last=next;
    } else if(beat.action==='focus' && beat.targetIds.some(id=>!objects.has(id))) issue(['beats',i],'focus targets objects, not stages');
  });
  if(last!==props.stages.length-1) issue(['beats'],`Every authored motion stage must be played using action="transform"; still missing: ${props.stages.slice(last+1).map(s=>s.id).join(', ')}`);
}

/** Validate the authored geometry without requiring host-owned narration. */
export function isMotionSceneDisplayPayload(value:unknown):boolean {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const {presentation,activeTargetIds,previousActiveTargetIds,progress,...authored}=value as Record<string,unknown>;
  const parsed=motionSceneComponentSchema.safeParse({type:'motion-scene.v1',props:authored});
  if(!parsed.success)return false;
  const failures:string[]=[];
  validateMotionScene(parsed.data.props,undefined,(_path,message)=>failures.push(message));
  return failures.length===0;
}

export const motionSceneAuthoringInstructions=[
  'motion-scene.v1 是按内容自行搭建的自由二维动画场景，不是另一套固定版式。props.description写清本镜头可见的教学证据；objects中的图形按清单从后往前排列，文字/公式/数值标注由宿主放在前景并使用现有舞台底色保证可读。每句beat.animation写当句实际变化。标注要放在所指对象旁边，不压住主要图形；组合真实对应知识的对象、空间、连线、遮罩、路径、数字与公式，不把每个对象都画成文字矩形。',
  '画布1000×500，x/y是对象中心、y向下，保持重要内容在边距24以内的可视区。shape(rect/ellipse/polygon)需要width/height，polygon.points为相对中心的实际局部坐标（不是0..1）；path.points也相对x/y，可closed填充、arrow箭头、draw从0到1绘制。group提供共同变换，parentId引用group后坐标相对父组；clipId引用shape，maskOnly=true的遮罩本身不显示。',
  'text用text、width、height，formula用latex和固定文本框，number用value/decimals/prefix/suffix及固定文本框。size=label/body/heading由宿主字体角色控制，颜色只用tone=primary/secondary/positive/caution/ink/muted，fill=solid/soft/none。不要写十六进制颜色、CSS、SVG字符串或代码。字体框在运动中不能重排或自动缩字号；文字宜12字内，详细解释放在口播。',
  '对象名称、读数与结论标签必须用anchorId绑定正在解释的对象，anchorPort=top/bottom/left/right/center，x/y此时是世界方向偏移量（不是绝对位置），不再写parentId。例如柱条{id:"costBar",kind:"shape",shape:"rect",x:600,y:300,width:60,height:120}，数字{kind:"number",id:"costValue",anchorId:"costBar",anchorPort:"top",x:0,y:-24,value:5,width:100,height:32}；柱条移动/变高时数字自动跟随。标题、无对应对象的总结可用画布坐标。一个指标的名称和数值要绑定同一指标对象/组，不能分别猜位置。A/B两根柱需有清晰的一组类别标注，量纲不同的指标不得伪画在同一数值轴上。',
  'link引用from/to对象和fromPort/toPort(left/right/top/bottom/center)，自动跟随对象世界位置，bend控制曲线，draw控制连线出现。link必须x=y=0且没有parent/旋转/缩放；不要给它另写端点坐标。',
  'motion-scene创作只写component.props.description、objects；不要写props.stages。每句beat直接配animation={description,tracks,camera?,pace?}，tracks含targetId、to（只写改变的属性）、start/end为0..1比例、easing=smooth/linear/spring、via为局部途经点且需配to.x/to.y。对象可并行或错峰；to可写opacity、x/y、rotation、scale、width/height（shape）、points（同顶点数）、draw（线）、value（number）、tone、text/latex。未改变的状态继续保留，每句同对象仅一条track。',
  '需要动作的每句必须写animation，不能另写action/targetIds。系统将该句和动画直接绑定；只停留讲解时写focusIds=[对象id]，建立/回看整体写focusIds=[]。一个beat只能选animation或focusIds，不能两者都有。pace=quick约0.65秒、measured约1.4秒、narration覆盖本句大部分时长，具体时长由真实配音计算；不写秒数帧数。最多40对象、8句，每场至少一句animation。',
  '例：beats:[{id:"b1",text:"先观察这两个对象。",focusIds:[]},{id:"b2",text:"把同一个对象移动过去。",animation:{description:"对象沿路径移动",tracks:[{targetId:"a",to:{x:600}}]}},{id:"b3",text:"抵达之后结果出现。",animation:{description:"结果出现",tracks:[{targetId:"b",to:{opacity:1}}]}}]。初始对象放在objects，不需要额外setup阶段或另一份阶段清单。',
  '先画明确的原始状态，再让动作改变证据：排序应移动同一批数据、面积演示应拼同一组图形、因果过程应让载体沿具体路径到达后才出现结果。示意图注明模型边界。不要画与内容无关的球/线装饰，不把概念名称换成图标就声称解释了机制。',
  '动手核对几何与口播：中心坐标不能当左上角，所有旋转绕对象中心，改变坐标后检查接合边和面积/数量是否真的保持。镜头推近不能裁掉正在解释的标注。只在已演示的条件下下结论；例如两个直角三角形可拼矩形，但任意两个全等三角形一般只能直接拼成平行四边形，不可把前者的演示宣称为后者已完成的证明。',
].join('\n');
