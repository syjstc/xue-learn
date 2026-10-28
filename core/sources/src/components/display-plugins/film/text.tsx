import {InlineMathText} from "../../markdown/inline-math-text.js";
import {wrapStoryMath} from './text-layout.js';
export {wrapStoryCodeLine,wrapStoryMath} from './text-layout.js';


export function StoryText({text,display=false}:{text:string;display?:boolean}) {return <InlineMathText text={text} display={display} fitToContainer wrapDisplayMath={wrapStoryMath}/>;}
