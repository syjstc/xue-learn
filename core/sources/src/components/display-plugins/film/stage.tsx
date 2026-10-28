import React,{useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {THEME as T,tint} from './theme.js';
import './lesson-board.css';
import './stage.css';
const W=1516.8,H=777.6;
const theme = {'--rm-stage':T.stage,'--rm-ink':T.ink,'--rm-muted':T.muted,'--rm-accent':T.accent,'--rm-accent-text':T.accentText,'--rm-accent-soft':T.accentSoft,'--rm-border':T.border,'--rm-surface':T.surface,'--rm-inset':T.inset,'--rm-compare':T.compare,'--rm-shadow':tint(T.ink,.07),'--lp-ink':T.ink} as CSSProperties;
/** Exactly the same design coordinates in lesson reading, player and capture. */
export function FilmStage({children,kind,designWidth=W}:{children:ReactNode;kind:string;designWidth?:number}) {
  const host=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({width:W,height:H});
  useLayoutEffect(()=>{const element=host.current;if(!element)return;
    const measure=()=>{const width=element.clientWidth,height=element.clientHeight;if(width>0&&height>0)setSize(old=>old.width===width&&old.height===height?old:{width,height});};
    measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
  },[]);
  const scale=Math.min(size.width/designWidth,size.height/H);
  return <div ref={host} className="display-film-stage" style={theme} data-display-artwork={kind}>
    <div className="display-film-canvas" style={{width:designWidth,height:H,left:(size.width-designWidth*scale)/2,top:(size.height-H*scale)/2,transform:`scale(${scale})`}}>
      <div className="rm-native-board">{children}</div>
    </div>
  </div>;
}
