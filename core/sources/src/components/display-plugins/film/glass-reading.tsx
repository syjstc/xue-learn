import React, {useRef} from 'react';
import {usePresentationFit} from '../../course-display/presentation-stage.js';
import {StoryText} from './text.js';
import {ease} from './lesson-motion.js';
import type {conversationPages} from '../conversation.js';
import {GlassDecor, GlassEmblem, GlassHeading} from './glass-scene.js';
import './glass-reading.css';

export function GlassText({title, text, seconds}: {title?: string; text: string; seconds: number}) {
  const viewport = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null);
  usePresentationFit(viewport, canvas, true);
  const entrance = ease(seconds / 1);
  return <div ref={viewport} className="rm-glass-reading-viewport"><div ref={canvas} className="rm-glass-reading-canvas">
    <article className="rm-glass-text rm-glass-tone rm-glass-surface" data-tone="0" data-animation-component="text.v1">
      <GlassDecor seconds={seconds}/>
      <div className="rm-glass-text-copy" style={{opacity: entrance, transform: `translateY(${(1 - entrance) * 24}px)`}}>
        <span className="rm-glass-rule" aria-hidden="true"/>
        {title && <h2><StoryText text={title}/></h2>}
        <p><StoryText text={text}/></p>
        <div className="rm-glass-text-foot" aria-hidden="true"><span/><i/><i/><i/></div>
      </div>
      <div className="rm-glass-text-art" aria-hidden="true"><GlassEmblem seconds={seconds}/><svg viewBox="0 0 240 260" fill="none"><path d="M25 212h190M25 224h110M25 236h65" stroke="var(--glass-color)" strokeOpacity=".17" strokeWidth="3" strokeLinecap="round"/><circle className="rm-glass-line-light" cx={25 + (seconds * 14 % 190)} cy="212" r="4" fill="var(--glass-color)" opacity=".45"/></svg></div>
    </article>
  </div></div>;
}

type DialoguePage = ReturnType<typeof conversationPages>[number];
export function GlassConversation({title, turns, speakers, page, pages, seconds, entrySeconds, activeId, progress, interactive, onPage}: {
  title?: string; turns: DialoguePage; speakers: readonly string[]; page: number; pages: number; seconds: number; entrySeconds: number;
  activeId?: string; progress: number; interactive: boolean; onPage: (page: number) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null);
  usePresentationFit(viewport, canvas, true);
  return <div ref={viewport} className="rm-glass-reading-viewport"><div ref={canvas} className="rm-glass-reading-canvas">
    <article className="rm-glass-dialogue" data-animation-component="conversation.v1">
      <GlassHeading title={title ?? ''} aside={<small>{page + 1} / {pages}</small>}/>
      <div className="rm-glass-dialogue-rows">{turns.map((turn, index) => {
        const speaker = Math.max(0, speakers.indexOf(turn.speaker));
        const selected = activeId === turn.id;
        const entrance = ease((entrySeconds - index * .16) / .9);
        return <section key={`${turn.id}:${turn.part}`} data-conversation-turn={turn.id} className="rm-glass-dialogue-turn rm-glass-tone rm-glass-surface" data-tone={speaker % 3} data-reply={speaker % 2 || undefined} style={{'--glass-focus': selected ? progress : 0, marginLeft: speaker % 2 ? 95 : 0, marginRight: speaker % 2 ? 0 : 95, opacity: entrance * (!activeId || selected ? 1 : .78), transform: `translate(${(1 - entrance) * (speaker % 2 ? 30 : -30)}px, ${(1 - entrance) * 13}px)`} as React.CSSProperties}>
          <GlassDecor seconds={seconds} index={speaker}/>
          <span className="rm-glass-dialogue-avatar" aria-hidden="true">{Array.from(turn.speaker)[0]}</span>
          <div className="rm-glass-dialogue-copy"><div className="rm-glass-dialogue-speaker"><strong><StoryText text={turn.speaker}/></strong>{turn.parts > 1 && <small>{turn.part + 1}/{turn.parts}</small>}<i aria-hidden="true"/></div><p><StoryText text={turn.text}/></p></div>
        </section>;
      })}</div>
      {interactive && pages > 1 && <nav aria-label="对话翻页"><button disabled={page === 0} onClick={() => onPage(page - 1)}>上一页</button><span>{page + 1} / {pages}</span><button disabled={page === pages - 1} onClick={() => onPage(page + 1)}>下一页</button></nav>}
    </article>
  </div></div>;
}
