export type ConversationTurn={id:string;speaker:string;text:string};
/** Keep every original code point; pages provide space rather than clipping a long dialogue. */
export function conversationPages(turns:readonly ConversationTurn[]){
 const parts=turns.flatMap(turn=>{
  const codepoints=Array.from(turn.text),chunks:string[]=[];
  for(let start=0;start<codepoints.length;start+=120)chunks.push(codepoints.slice(start,start+120).join(''));
  return (chunks.length?chunks:['']).map((text,index)=>({...turn,text,part:index,parts:chunks.length||1}));
 });
 return Array.from({length:Math.max(1,Math.ceil(parts.length/3))},(_,index)=>parts.slice(index*3,index*3+3));
}
