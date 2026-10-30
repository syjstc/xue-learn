import React,{useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {THEME as T,tint} from './theme.js';
import './lesson-board.css';
import './stage.css';
const W=1516.8,H=777.6;
const theme = {'--rm-stage':T.stage,'--rm-ink':T.ink,'--rm-muted':T.muted,'--rm-accent':T.accent,'--rm-accent-text':T.accentText,'--rm-accent-soft':T.accentSoft,'--rm-border':T.border,'--rm-surface':T.surface,'--rm-inset':T.inset,'--rm-compare':T.compare,'--rm-shadow':tint(T.ink,.07),'--lp-ink':T.ink} as CSSProperties;
/** Exactly the same design coordinates in lesson reading, player and capture. */
export function FilmStage({children,kind,designWidth=W,fluid=false}:{children:ReactNode;kind:string;designWidth?:number;fluid?:boolean}) {
  const host=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({width:W,height:H});
  useLayoutEffect(()=>{const element=host.current;if(!element)return;
    const measure=()=>{const width=element.clientWidth,height=element.clientHeight;if(width>0&&height>0)setSize(old=>old.width===width&&old.height===height?old:{width,height});};
    measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
  },[]);
  // Text and formula boards reflow inside a composition. Scaling a complete
  // widescreen board into each column halves the type and wastes its height.
  const width=fluid?Math.max(720,Math.min(designWidth,size.width/size.height*H)):designWidth;
  const scale=Math.min(size.width/width,size.height/H);
  return <div ref={host} className="display-film-stage" style={theme} data-display-artwork={kind} data-display-layout={fluid&&width<1100?'compact':undefined}>
    <div className="display-film-canvas" style={{width,height:H,left:(size.width-width*scale)/2,top:(size.height-H*scale)/2,transform:`scale(${scale})`}}>
      <div className="rm-native-board">{children}</div>
    </div>
  </div>;
}
