import React, {useId} from 'react';
import './glass-sculpture.css';

/** Decorative geometry, sampled from the host clock just like the teaching content. */
export function GlassSculpture({index, seconds}: {index: number; seconds: number}) {
  const id = useId().replace(/:/g, '');
  const phase = seconds * .55 + index * 1.7;
  const x = 180 + Math.cos(phase) * 116;
  const y = 145 + Math.sin(phase) * 85;
  return <svg className="rm-card-sculpture" viewBox="0 0 360 290" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-glass`} x1="100" y1="60" x2="265" y2="235" gradientUnits="userSpaceOnUse">
        <stop stopColor="white" stopOpacity=".95"/><stop offset=".45" stopColor="var(--card-tint)"/><stop offset="1" stopColor="var(--card-color)" stopOpacity=".72"/>
      </linearGradient>
      <linearGradient id={`${id}-edge`} x1="90" y1="70" x2="260" y2="230" gradientUnits="userSpaceOnUse">
        <stop stopColor="white"/><stop offset="1" stopColor="var(--card-color)" stopOpacity=".45"/>
      </linearGradient>
    </defs>
    <ellipse className="rm-card-orbit" cx="180" cy="145" rx="116" ry="85" stroke="var(--card-color)" strokeOpacity=".18" strokeDasharray="2 9"/>
    <ellipse cx="180" cy="257" rx="72" ry="10" fill="var(--card-color)" opacity=".09"/>
    <g className="rm-card-sculpture-float" style={{transform: `translateY(${Math.sin(phase) * 6}px) rotate(${Math.sin(phase * .65) * 3}deg)`}}>
      {index % 3 === 0 ? <>
        <ellipse cx="180" cy="145" rx="79" ry="79" stroke="var(--card-color)" strokeWidth="22" opacity=".12"/>
        <circle cx="180" cy="145" r="66" fill={`url(#${id}-glass)`} stroke={`url(#${id}-edge)`} strokeWidth="2"/>
        <ellipse cx="180" cy="145" rx="102" ry="34" transform="rotate(-34 180 145)" stroke="var(--card-color)" strokeWidth="2" opacity=".6"/>
        <ellipse cx="180" cy="145" rx="32" ry="101" transform="rotate(-34 180 145)" stroke="white" strokeWidth="2" opacity=".8"/>
        <circle cx="180" cy="145" r="17" fill="var(--card-color)" opacity=".85"/>
        <circle cx="173" cy="138" r="5" fill="white" opacity=".8"/>
      </> : index % 3 === 1 ? <>
        <path d="M180 51 263 99 180 147 97 99Z" fill={`url(#${id}-glass)`} stroke={`url(#${id}-edge)`} strokeWidth="2"/>
        <path d="M97 99 180 147 180 238 97 190Z" fill="var(--card-color)" fillOpacity=".2" stroke="var(--card-color)" strokeOpacity=".35" strokeWidth="2"/>
        <path d="M180 147 263 99 263 190 180 238Z" fill="var(--card-color)" fillOpacity=".42" stroke="var(--card-color)" strokeOpacity=".45" strokeWidth="2"/>
        <path d="M97 144 180 192 263 144M139 76 222 124 222 214M222 76 139 124 139 214" stroke="white" strokeOpacity=".65" strokeWidth="2"/>
        <path d="M180 51V100M157 88 180 101 203 88" stroke="var(--card-color)" strokeOpacity=".5" strokeWidth="2"/>
      </> : <>
        <circle cx="180" cy="145" r="89" stroke="var(--card-color)" strokeOpacity=".16" strokeWidth="2"/>
        <rect x="119" y="84" width="122" height="122" rx="31" transform="rotate(-12 180 145)" fill="var(--card-color)" fillOpacity=".15" stroke="var(--card-color)" strokeOpacity=".3" strokeWidth="2"/>
        <rect x="119" y="84" width="122" height="122" rx="31" transform="rotate(9 180 145)" fill={`url(#${id}-glass)`} stroke={`url(#${id}-edge)`} strokeWidth="2"/>
        <path d="m153 145 19 19 37-40" stroke="white" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="252" cy="90" r="8" fill="var(--card-color)" opacity=".7"/>
      </>}
    </g>
    <circle className="rm-card-orbit-particle" cx={x} cy={y} r="5" fill="var(--card-color)"/>
    <path d="M73 72v12m-6-6h12M281 209v10m-5-5h10" stroke="var(--card-color)" strokeWidth="2" strokeLinecap="round" opacity=".5"/>
    <circle cx="281" cy="69" r="3" fill="var(--card-color)" opacity=".4"/>
    <circle cx="84" cy="213" r="3" fill="var(--card-color)" opacity=".35"/>
  </svg>;
}

