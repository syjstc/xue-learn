import {DisplayPlaceholder} from '../../display-runtime/index.js';
import {InlineMathText} from "../../markdown/inline-math-text.js";
import React, {useLayoutEffect, useRef, useState} from 'react';
import lottieModule, {type AnimationItem,type LottiePlayer} from 'lottie-web';
import type {RemotionLottieExplainerComponent} from "./types.js";
import type {LessonMotion} from './lesson-motion.js';
import {createLottiePreset} from './lottie-presets.js';
// NodeNext consumers can expose the CommonJS package through one extra default.
const lottie=((lottieModule as unknown as {default?:LottiePlayer}).default??lottieModule) as LottiePlayer;

export function LottieExplainer({props, motion}: {props: RemotionLottieExplainerComponent['props']; motion: LessonMotion}) {
  const host = useRef<HTMLDivElement>(null), instance = useRef<AnimationItem | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const playStart = motion.active?.action === 'play' ? motion.active.start : null;
  const seconds = playStart === null ? motion.seconds : motion.activeSeconds;
  const targetFrame = Math.min(179, Math.max(0, seconds * 60));
  const requestedFrame = useRef(targetFrame); requestedFrame.current = targetFrame;
  useLayoutEffect(() => {
    setStatus('loading');
    if (!host.current) return;
    let animation: AnimationItem;
    try {
      animation = lottie.loadAnimation({container: host.current, renderer: 'svg', loop: false, autoplay: false, animationData: createLottiePreset(props.preset), rendererSettings: {progressiveLoad: false, hideOnTransparent: false}});
      instance.current = animation;
      const ready = () => {animation.goToAndStop(requestedFrame.current, true); setStatus('ready');};
      animation.addEventListener('DOMLoaded', ready);
      animation.addEventListener('data_failed', () => setStatus('error'));
      animation.addEventListener('error', () => setStatus('error'));
      if (animation.isLoaded) ready();
    } catch {setStatus('error');}
    return () => {instance.current = null; animation?.destroy();};
  }, [props.preset]);
  useLayoutEffect(() => {if (instance.current?.isLoaded) instance.current.goToAndStop(targetFrame, true);}, [targetFrame, status]);
  const dense = props.items.length > 3 || props.items.reduce((sum, item) => sum + item.label.length + (item.detail?.length ?? 0), 0) > 180;
  if(status==='error')return <DisplayPlaceholder failure={{reason:'resource-error',message:'The animation failed to load',kind:'media:lottie'}}/>;
  return <div className={`rm-lottie rm-panel${dense ? ' rm-lottie-dense' : ''}`} data-animation-component="lottie-explainer.v1" data-remotion-resource-status={status}>
    <div className="rm-lottie-visual" ref={host} data-lottie-frame={targetFrame}/>
    <div className="rm-lottie-copy">{props.items.map((item, i) => <div key={item.id} style={{opacity: motion.opacity(item.id)}}><span>{String(i + 1).padStart(2, '0')}</span><h3><InlineMathText text={item.label}/></h3>{item.detail && <p><InlineMathText text={item.detail}/></p>}</div>)}</div><p className="rm-lottie-caption"><InlineMathText text={props.caption}/></p>
  </div>;
}
