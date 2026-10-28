// Deterministic camera-space geometry. World units, screen positions and depth
// are derived from the requested frame; playback order never enters this model.
export type V3 = {x:number;y:number;z:number};
export type Camera = {yaw:number;pitch:number;scale:number;cx:number;cy:number};
export const project=(p:V3,c:Camera)=>{
  const x=p.x*Math.cos(c.yaw)-p.z*Math.sin(c.yaw);
  const depth=p.x*Math.sin(c.yaw)+p.z*Math.cos(c.yaw);
  const y=depth*Math.sin(c.pitch)-p.y*Math.cos(c.pitch);
  const z=depth*Math.cos(c.pitch)+p.y*Math.sin(c.pitch);
  const perspective=1/(1-z/2600);
  return {x:c.cx+x*c.scale*perspective,y:c.cy+y*c.scale*perspective,depth:z};
};
export const cellX=(cell:number)=>(cell-3.5)*154;
export const nextCell=(cell:number,action:'right'|'stay')=>cell+(action==='right'?1:0);
export const isVisible=(cell:number)=>cell<1.5||cell>4.5;
export const projectedPoints=(points:V3[],c:Camera)=>points.map(p=>{const q=project(p,c);return `${q.x.toFixed(3)},${q.y.toFixed(3)}`;}).join(' ');
