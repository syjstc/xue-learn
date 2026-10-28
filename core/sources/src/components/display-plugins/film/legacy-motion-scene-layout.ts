import type {LegacyMotionScenePayload} from './legacy-motion-scene-schema.js';

/** Frame every authored stage together. Changing visibility never moves the camera,
 * and SVG coordinates, angles and relative lengths stay exactly as supplied. */
export function legacyMotionViewBox(payload:LegacyMotionScenePayload):string {
  const points:[number,number][]=[];
  for(const object of payload.objects){
    if(object.type==='rect')points.push([object.x,object.y],[object.x+object.width,object.y+object.height]);
    else if(object.type==='line'||object.type==='arrow')points.push(object.from,object.to);
    else if(object.type==='point')points.push([object.position[0]-4,object.position[1]-4],[object.position[0]+4,object.position[1]+4]);
    else if(object.type==='arc'){
      const low=Math.min(object.startAngle,object.endAngle),high=Math.max(object.startAngle,object.endAngle);
      const angles=[object.startAngle,object.endAngle];
      for(let angle=Math.ceil(low/90)*90;angle<=high;angle+=90)angles.push(angle);
      for(const angle of angles){const radians=angle*Math.PI/180;points.push([object.center[0]+object.radius*Math.cos(radians),object.center[1]+object.radius*Math.sin(radians)]);}
    }
  }
  const left=Math.min(...points.map(point=>point[0])),right=Math.max(...points.map(point=>point[0]));
  const top=Math.min(...points.map(point=>point[1])),bottom=Math.max(...points.map(point=>point[1]));
  // Padding includes arrowheads/strokes and avoids excessive enlargement of flat diagrams.
  const padding=Math.max(18,Math.max(right-left,bottom-top)*.08);
  const width=Math.max(120,right-left+padding*2),height=Math.max(100,bottom-top+padding*2);
  return `${(left+right-width)/2} ${(top+bottom-height)/2} ${width} ${height}`;
}
