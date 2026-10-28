import {TextBox} from "../../course-display/teaching/templates/primitives.js";
import {SvgMathText} from "../../markdown/svg-math-text.js";
import {InlineMathText} from "../../markdown/inline-math-text.js";
import React from 'react';
import type {RemotionAnimatedChartComponent} from "./types.js";
import type {LessonMotion} from './lesson-motion.js';
import {ease} from './lesson-motion.js';
import {THEME as T, tint} from './theme.js';

export const chartColors = [T.accent, T.compare, T.caution, T.positive];
export function chartBounds(series: RemotionAnimatedChartComponent['props']['series']) {
  const values = series.flatMap(item => [...item.values]);
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  return {min, max: max === min ? min + 1 : max};
}
const number = (value: number) => new Intl.NumberFormat('en', {maximumFractionDigits: 2, notation: Math.abs(value) >= 1e4 ? 'compact' : 'standard'}).format(value);

export function AnimatedChart({props, motion}: {props: RemotionAnimatedChartComponent['props']; motion: LessonMotion}) {
  const {categories, series, chart, unit} = props;
  const bounds = chartBounds(series);
  const hasDetails=categories.some(item=>item.detail);
  const left = 100, top = 64, width = 1170, height = hasDetails?325:385;
  const y = (n: number) => top + height * (bounds.max - n) / (bounds.max - bounds.min);
  const zero = y(0), stride = width / categories.length;
  const grow = ease(motion.seconds / 1.7);
  const growth = (seriesId: string, categoryId: string) => motion.active?.action === 'transform' && (motion.targets.includes(seriesId) || motion.targets.includes(categoryId)) ? motion.progress : grow;
  const categoryOpacity = (id: string, seriesId: string) => !motion.targets.length || motion.targets.includes(id) || motion.targets.includes(seriesId) ? 1 : .28;
  let arcStart = -Math.PI / 2;
  const total = series[0].values.reduce((sum, value) => sum + value, 0);
  const circle = (angle: number, r: number) => [480 + Math.cos(angle) * r, 300 + Math.sin(angle) * r];
  return <div className="rm-new-chart rm-panel" data-animation-component="animated-chart.v1">
    <div className="rm-chart-legend">{series.map((item, i) => <span key={item.id}><i style={{background: chartColors[i]}}/><InlineMathText text={item.label}/></span>)}<b><InlineMathText text={unit}/></b></div>
    <svg viewBox="0 0 1400 640" role="img" aria-label={series.map(s => `${s.label}: ${s.values.join(', ')}`).join('; ')}>
      {chart !== 'donut' ? <>
        {Array.from({length: 5}, (_, i) => {const value = bounds.min + (bounds.max - bounds.min) * i / 4; return <g key={i}><line x1={left} x2={left + width} y1={y(value)} y2={y(value)} stroke={T.border} strokeDasharray="4 7"/><SvgMathText x={left - 20} y={y(value) + 7} textAnchor="end" fill={T.muted} fontSize="22">{number(value)}</SvgMathText></g>;})}
        <line x1={left} x2={left + width} y1={zero} y2={zero} stroke={T.muted} strokeWidth="2"/>
        {categories.map((item, i) => <g key={item.id} opacity={motion.opacity(item.id)}><TextBox x={left + stride * i + 6} y={hasDetails?430:523} width={stride - 12} height={hasDetails?65:104} text={item.label} size={22} weight={400}/>{item.detail&&<TextBox x={left+stride*i+6} y={500} width={stride-12} height={128} text={item.detail} size={18} weight={400}/>}</g>)}
        {series.map((item, s) => {
          const barWidth = Math.min(110, (stride - 35) / series.length);
          const points = item.values.map((value, i) => [left + stride * (i + .5), zero + (y(value) - zero) * growth(item.id, categories[i].id)]);
          return <g key={item.id}>
            {chart === 'line' && <><path d={points.map(([x, py], i) => `${i ? 'L' : 'M'}${x} ${py}`).join(' ') + ` L${points.at(-1)![0]} ${zero} L${points[0][0]} ${zero} Z`} fill={tint(chartColors[s], .06)}/><path d={points.map(([x, py], i) => `${i ? 'L' : 'M'}${x} ${py}`).join(' ')} fill="none" stroke={chartColors[s]} strokeWidth="5" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - grow} opacity={motion.opacity(item.id)}/></>}
            {item.values.map((value, i) => {
              const x = chart === 'line' ? points[i][0] : left + stride * (i + .5) + (s - (series.length - 1) / 2) * barWidth;
              const py = zero + (y(value) - zero) * growth(item.id, categories[i].id);
              return <g key={categories[i].id} opacity={categoryOpacity(categories[i].id, item.id)} data-chart-value={value}>
                {chart === 'bar' ? <rect x={x - barWidth * .41} y={Math.min(zero, py)} width={barWidth * .82} height={Math.abs(zero - py)} rx="6" fill={chartColors[s]}/> : <circle cx={x} cy={py} r="8" fill={T.surface} stroke={chartColors[s]} strokeWidth="4"/>}
                <SvgMathText x={x} y={py + (value < 0 ? 27 : -16) + (chart === 'line' ? s * (value < 0 ? 23 : -23) : 0)} textAnchor="middle" fill={T.ink} fontSize={categories.length * series.length > 12 ? 16 : 23} fontWeight="650" opacity={grow}>{number(value)}</SvgMathText>
              </g>;
            })}
          </g>;
        })}
      </> : <>
        {categories.map((item, i) => {
          const value = series[0].values[i], angle = value / total * Math.PI * 2 * grow;
          const end = arcStart + Math.min(angle, Math.PI * 2 - .00001);
          const [a,b] = circle(arcStart, 205), [c,d] = circle(end, 205), [e,f] = circle(end, 142), [g,h] = circle(arcStart, 142);
          const path = `M${a} ${b} A205 205 0 ${angle > Math.PI ? 1 : 0} 1 ${c} ${d} L${e} ${f} A142 142 0 ${angle > Math.PI ? 1 : 0} 0 ${g} ${h} Z`;
          arcStart += angle;
          return <g key={item.id} opacity={categoryOpacity(item.id, series[0].id)}><path d={path} fill={chartColors[i % chartColors.length]} stroke={T.surface} strokeWidth="4"/><circle cx="815" cy={70 + i * 69} r="6" fill={chartColors[i % chartColors.length]}/><SvgMathText x="837" y={76 + i * 69} fill={T.ink} fontSize="23">{item.label}</SvgMathText><SvgMathText x="837" y={101 + i * 69} fill={T.muted} fontSize="20">{number(value)} · {number(value / total * 100)}%</SvgMathText></g>;
        })}
        <SvgMathText x="480" y="295" textAnchor="middle" fontSize="60" fontWeight="720" fill={T.ink}>{number(total)}</SvgMathText><SvgMathText x="480" y="343" textAnchor="middle" fontSize="26" fill={T.muted}>{unit}</SvgMathText>
      </>}
    </svg>
  </div>;
}
