import {z} from 'zod';

const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const text=(limit:number)=>z.string().min(1).max(limit).regex(/\S/);
const x=z.number().finite().min(0).max(1000),y=z.number().finite().min(0).max(500);
const point=z.tuple([x,y]);
const common={id,label:text(240).optional(),color:z.string().regex(/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i).optional(),group:id.optional()};
const primitive=z.discriminatedUnion('type',[
  z.object({...common,type:z.literal('rect'),x,y,width:z.number().finite().positive().max(1000),height:z.number().finite().positive().max(500)}).strict(),
  z.object({...common,type:z.literal('line'),from:point,to:point,dashed:z.boolean().optional()}).strict(),
  z.object({...common,type:z.literal('arrow'),from:point,to:point,dashed:z.boolean().optional()}).strict(),
  z.object({...common,type:z.literal('point'),position:point}).strict(),
  z.object({...common,type:z.literal('arc'),center:point,radius:z.number().finite().positive().max(500),startAngle:z.number().finite().min(-360).max(360),endAngle:z.number().finite().min(-360).max(360),dashed:z.boolean().optional()}).strict(),
]);

/** The saved primitive dialect uses SVG coordinates: rectangle x/y is its
 * top-left corner and positive angles turn clockwise on the screen. It is
 * validated separately so no canonical motion geometry is guessed or rewritten. */
export const legacyMotionScenePayloadSchema=z.object({
  description:text(1000),
  objects:z.array(primitive).min(2).max(40),
  stages:z.array(z.object({id,label:text(240),visibleIds:z.array(id).min(1).max(40)}).strict()).min(1).max(8),
}).strict().superRefine((payload,context)=>{
  const objectIds=new Set<string>(),stageIds=new Set<string>(),shown=new Set<string>();
  const issue=(path:(string|number)[],message:string)=>context.addIssue({code:'custom',path,message});
  payload.objects.forEach((object,index)=>{
    if(objectIds.has(object.id))issue(['objects',index,'id'],'Object IDs must be unique');
    objectIds.add(object.id);
    if(object.type==='rect'&&(object.x+object.width>1000||object.y+object.height>500))issue(['objects',index],'Rectangle must remain inside the authored 1000 × 500 canvas');
    if((object.type==='line'||object.type==='arrow')&&object.from[0]===object.to[0]&&object.from[1]===object.to[1])issue(['objects',index],'Line endpoints must be distinct');
    if(object.type==='arc'){
      const [cx,cy]=object.center;
      if(cx-object.radius<0||cx+object.radius>1000||cy-object.radius<0||cy+object.radius>500)issue(['objects',index],'Arc must remain inside the authored 1000 × 500 canvas');
      const span=Math.abs(object.endAngle-object.startAngle);
      if(span===0||span>360)issue(['objects',index],'Arc span must be greater than zero and at most 360 degrees');
    }
  });
  payload.stages.forEach((stage,index)=>{
    if(stageIds.has(stage.id)||objectIds.has(stage.id))issue(['stages',index,'id'],'Stage IDs must be unique and distinct from object IDs');
    stageIds.add(stage.id);
    const visible=new Set<string>();
    stage.visibleIds.forEach((reference,position)=>{
      if(!objectIds.has(reference))issue(['stages',index,'visibleIds',position],'Visible object must exist in this scene');
      if(visible.has(reference))issue(['stages',index,'visibleIds',position],'Visible object IDs must be unique');
      visible.add(reference);shown.add(reference);
    });
  });
  payload.objects.forEach((object,index)=>{if(!shown.has(object.id))issue(['objects',index,'id'],'Every authored object must be visible in at least one stage');});
});

export type LegacyMotionScenePayload=z.infer<typeof legacyMotionScenePayloadSchema>;
export type LegacyMotionPrimitive=LegacyMotionScenePayload['objects'][number];

export function parseLegacyMotionScenePayload(value:unknown):LegacyMotionScenePayload|undefined {
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  // These fields are supplied by the host clock and are not authored geometry.
  const {presentation,activeTargetIds,previousActiveTargetIds,progress,...authored}=value as Record<string,unknown>;
  const parsed=legacyMotionScenePayloadSchema.safeParse(authored);
  return parsed.success?parsed.data:undefined;
}
export function isLegacyMotionScenePayload(value:unknown):boolean{return parseLegacyMotionScenePayload(value)!==undefined;}
