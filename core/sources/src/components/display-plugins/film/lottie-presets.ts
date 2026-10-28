import type {RemotionLottiePreset} from "./types.js";
import {THEME as T} from './theme.js';

// Original project-owned Bodymovin assets. Geometry, color and timing belong to
// the component registry; an LLM supplies only semantic labels and preset IDs.
const color = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).concat(1);
const still = (k: unknown) => ({a: 0, k});
const animated = (from: number[], to: number[], end = 120) => ({a: 1, k: [{t: 0, s: from, e: to, o: {x: [.33], y: [0]}, i: {x: [.67], y: [1]}}, {t: end, s: to}]});
const transform = (p: unknown, r: unknown = still(0), s: unknown = still([100, 100, 100])) => ({o: still(100), r, p, a: still([0, 0, 0]), s});
const dot = (index: number, x: number, y: number, size: number, fill: string, motion?: unknown) => ({ddd: 0, ind: index, ty: 4, nm: `node-${index}`, sr: 1, ks: transform(motion ?? still([x, y, 0])), ao: 0, shapes: [{ty: 'el', p: still([0, 0]), s: still([size, size]), nm: 'circle'}, {ty: 'fl', c: still(color(fill)), o: still(100), r: 1}], ip: 0, op: 180, st: 0, bm: 0});
const ring = (index: number, width: number, height: number, rotation = 0) => ({ddd: 0, ind: index, ty: 4, nm: `orbit-${index}`, sr: 1, ks: transform(still([380, 300, 0]), animated([rotation], [rotation + 90], 180)), ao: 0, shapes: [{ty: 'el', p: still([0, 0]), s: still([width, height])}, {ty: 'st', c: still(color(T.accent)), o: still(35), w: still(2), lc: 2, lj: 2}], ip: 0, op: 180, st: 0, bm: 0});
const line = (index: number, vertices: number[][], fill: string, rotation?: unknown) => ({ddd: 0, ind: index, ty: 4, nm: `connector-${index}`, sr: 1, ks: transform(still([380, 300, 0]), rotation ?? still(0)), ao: 0, shapes: [{ty: 'sh', ks: still({v: vertices, i: vertices.map(() => [0,0]), o: vertices.map(() => [0,0]), c: false})}, {ty: 'st', c: still(color(fill)), o: still(70), w: still(6), lc: 2, lj: 2}], ip: 0, op: 180, st: 0, bm: 0});

export function createLottiePreset(preset: RemotionLottiePreset) {
  const layers: unknown[] = [];
  if (preset === 'orbit-cycle') {
    layers.push(dot(1, 380, 300, 130, T.accent), ring(2, 470, 260, 15), ring(3, 470, 260, 75));
    for (let i = 0; i < 3; i++) {
      const satellite = dot(4 + i, 380, 300, 42, i ? T.compare : T.caution);
      satellite.ks = transform(still([380, 300, 0]), animated([i * 120], [i * 120 + 240], 180));
      satellite.shapes[0].p = still([230, 0]);
      layers.push(satellite);
    }
  } else if (preset === 'signal-flow') {
    for (let i = 0; i < 5; i++) layers.push(dot(i + 1, 140 + i * 120, 300, i % 2 ? 65 : 100, i % 2 ? T.compare : T.accent));
    for (let i = 0; i < 3; i++) layers.unshift(dot(i + 6, 0, 0, 17, T.caution, animated([100 + i * 90, 300, 0], [420 + i * 90, 300, 0], 180)));
    layers.push(line(10, [[-240,0],[240,0]], T.compare));
  } else {
    layers.push(dot(3, 0, 0, 105, T.accent, animated([180, 205, 0], [180, 325, 0], 180)), dot(4, 0, 0, 105, T.compare, animated([580, 325, 0], [580, 205, 0], 180)), dot(5, 380, 300, 28, T.caution), line(2,[[-205,0],[205,0]],T.ink,animated([17],[-17],180)), line(6,[[-44,122],[0,25],[44,122],[-44,122]],T.muted));
  }
  return {v: '5.13.0', fr: 60, ip: 0, op: 180, w: 760, h: 600, nm: `XueLearn ${preset}`, ddd: 0, assets: [], layers};
}
