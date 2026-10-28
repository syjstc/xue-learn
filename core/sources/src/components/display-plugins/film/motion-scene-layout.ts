import type {MotionObject,RemotionMotionSceneComponent} from "./motion-scene-schema.js";
export type Point={x:number;y:number};
export type Matrix=[number,number,number,number,number,number];
export type SampledObject=MotionObject & {contentOpacity?:number};

/** Allocate a stable glyph slot from every authored text state before playback.
 * This never changes type size/width or reacts to the current cue. Browser
 * overflow checks remain authoritative for unusual formulas/font metrics. */
export function reserveMotionText(props:RemotionMotionSceneComponent['props']):SampledObject[] {
  return props.objects.map(o=>{
    if(o.kind!=='text'&&o.kind!=='number'&&o.kind!=='formula')return {...o};
    const font=o.size==='heading'?28:o.size==='body'?20:16;
    const format=(value:number)=>`${o.kind==='number'?o.prefix??'':''}${value.toFixed(o.kind==='number'?o.decimals??0:0)}${o.kind==='number'?o.suffix??'':''}`;
    const variants=[o.kind==='text'?o.text:o.kind==='number'?format(o.value):''];
    for(const stage of props.stages)for(const track of stage.tracks)if(track.targetId===o.id) {
      if(track.to.text!==undefined)variants.push(track.to.text);
      if(track.to.value!==undefined)variants.push(format(track.to.value));
    }
    const lines=Math.max(1,...variants.map(value=>value.split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil([...line].reduce((width,c)=>width+font*(/[^\x00-\x7f]/.test(c)?1:/[MW@]/.test(c)?1:.65),0)/o.width)),0)));
    return {...o,height:Math.max(o.height,Math.ceil(lines*font*1.2+font*.2))};
  });
}

export const multiply=(a:Matrix,b:Matrix):Matrix=>[
  a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5],
];
export const project=(m:Matrix,p:Point):Point=>({x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]});
export function motionWorld(objects:SampledObject[]) {
  const entries=new Map(objects.map(o=>[o.id,o]));
  const cache=new Map<string,{matrix:Matrix;opacity:number;clips:string[]}>();
  const world=(id:string):{matrix:Matrix;opacity:number;clips:string[]}=>{
    const cached=cache.get(id);if(cached)return cached;
    const o=entries.get(id)!;
    const a=(o.rotation??0)*Math.PI/180,s=o.scale??1,c=Math.cos(a)*s,n=Math.sin(a)*s;
    const local:Matrix=[c,n,-n,c,o.x,o.y];
    let parent=o.parentId?world(o.parentId):undefined;
    if('anchorId' in o&&o.anchorId) {
      const target=world(o.anchorId),at=anchor(o.anchorId,o.anchorPort);
      parent={matrix:[1,0,0,1,at.x,at.y],opacity:target.opacity,clips:target.clips};
    }
    const result={matrix:parent?multiply(parent.matrix,local):local,opacity:(parent?.opacity??1)*(o.opacity??1),clips:[...(parent?.clips??[]),...(o.clipId?[o.clipId]:[])]};
    cache.set(id,result);return result;
  };
  const anchor=(id:string,port:string|undefined)=>{
    const o=entries.get(id)!,w='width' in o?o.width:0,h='height' in o?o.height:0;
    return project(world(id).matrix,{x:port==='left'?-w/2:port==='right'?w/2:0,y:port==='top'?-h/2:port==='bottom'?h/2:0});
  };
  return {world,anchor};
}

/** Authoring-only layout feedback. Keep legacy documents readable; new scenes
 * must not stack two independent visible labels on the same evidence. */
export function motionLabelCollisions(props:RemotionMotionSceneComponent['props']):string[] {
  let objects=reserveMotionText(props);
  const failures=new Set<string>();
  const inspect=(stage:string)=>{
    const {world}=motionWorld(objects);
    const labels=objects.flatMap(o=>{
      if(o.kind!=='text'&&o.kind!=='number')return [];
      const geometry=world(o.id);if(geometry.opacity<.05)return [];
      const text=o.kind==='text'?o.text:`${o.prefix??''}${o.value.toFixed(o.decimals??0)}${o.suffix??''}`;
      const font=o.size==='heading'?28:o.size==='body'?20:16;
      const width=Math.min(o.width,Math.max(...text.split('\n').map(line=>[...line].reduce((n,c)=>n+font*(/[^\x00-\x7f]/.test(c)?1:.65),0))));
      const height=Math.min(o.height,Math.ceil(font*1.2*Math.max(1,Math.ceil(width/o.width))));
      const center=o.align==='left'?(width-o.width)/2:o.align==='right'?(o.width-width)/2:0;
      const points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>project(geometry.matrix,{x:center+x*width/2,y:y*height/2}));
      return [{id:o.id,left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))}];
    });
    for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++) {
      const a=labels[i],b=labels[j],overlap=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      const smaller=Math.min((a.right-a.left)*(a.bottom-a.top),(b.right-b.left)*(b.bottom-b.top));
      if(overlap>64&&overlap>smaller*.3)failures.add(`${stage}: visible labels "${a.id}" and "${b.id}" overlap. Move one to a separate label lane or hide the old label before showing its replacement.`);
    }
  };
  inspect('initial');
  for(const stage of props.stages) {
    const tracks=new Map(stage.tracks.map(t=>[t.targetId,t.to]));
    objects=objects.map(o=>({...o,...tracks.get(o.id)}) as SampledObject);inspect(stage.id);
  }
  return [...failures].slice(0,12);
}
