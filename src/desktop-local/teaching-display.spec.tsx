import {flowParticleGeometry} from "./flow-particle-geometry.ts";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {TeachingDisplay} from "@xue-learn/core/source/src/components/course-display/teaching-display.tsx";
import {materialTeachingSteps, type MaterialTeaching} from "@xue-learn/core/source/libs/domain/src/material-teaching.ts";
import {TeachingVisualArt, supportsTeachingVisualArt} from "@xue-learn/core/source/src/components/course-display/teaching/teaching-visual.tsx";
import type {MaterialVisual} from "@xue-learn/core/source/libs/domain/src/material-visual.ts";
import {DisciplineScene} from "@xue-learn/core/source/src/components/course-display/teaching/templates/discipline-scenes.tsx";

jest.mock("@xue-learn/core/source/src/components/markdown/math-latex.tsx", () => ({MathLatex: () => null}));
jest.mock("@xue-learn/core/source/src/components/course-display/music-teaching-display.tsx", () => ({MusicTeachingDisplay: () => null, MusicTimelineContext: require("react").createContext({clocked:false})}));
jest.mock("katex/dist/katex.min.css", () => ({}));
jest.mock("@xue-learn/core/source/src/components/course-display/teaching/templates/templates.css", () => ({}));
jest.mock("@xue-learn/core/source/src/components/course-display/teaching/teaching-display.css", () => ({}));

const block: MaterialTeaching = {type: "teaching", version: 1, id: "sort_example", title: "比较与交换", templateId: "cs-sorting", content: {values: [3, 1, 2]}};
const intervals = materialTeachingSteps(block).map((step, index) => ({targetIds: [step.id], startTick: index * 480_000, durationTicks: 480_000}));
const render = (tick: number) => renderToStaticMarkup(<TeachingDisplay block={block} timeline={{intervals, tick}}/>);

test("comparison holds original positions through arbitrarily long narration and swap has a distinct cue", () => {
  const compared = render(959_999);
  expect(compared).toContain('data-teaching-sort-operation="compare-1"');
  expect(compared).toContain('data-teaching-sort-values="3,1,2"');
  expect(compared).toContain('data-teaching-sort-order="0,1,2"');
  const swapped = render(1_439_999);
  expect(swapped).toContain('data-teaching-sort-operation="swap-1"');
  expect(swapped).toContain('data-teaching-sort-values="1,3,2"');
  expect(swapped).toContain('data-teaching-sort-order="1,0,2"');
  expect(swapped).toContain('data-teaching-sort-item="value-1"');
});

test("reverse seek reproduces the identical mid-swap positions and fixed text geometry", () => {
  const middle = 960_000 + 172_800, before = render(middle);
  render(3_300_000); render(0);
  expect(render(middle)).toBe(before);
  const transforms = (html: string) => [...html.matchAll(/data-teaching-sort-item="([^"]+)"[^>]*transform="([^"]+)"/g)].map(match => [match[1], match[2]]);
  expect(transforms(before)).not.toEqual(transforms(render(960_000)));
  expect(transforms(before)).not.toEqual(transforms(render(1_439_999)));
});

test("layer narration reveals one accepted detail at a time without collapsing the previous structure", () => {
  const layers: MaterialTeaching = {...block, templateId: "general-layers", content: {layers: [{title: "界面", detail: "接收选择"}, {title: "处理", detail: "执行操作"}, {title: "存储", detail: "保存结果"}]}};
  const first = renderToStaticMarkup(<TeachingDisplay block={layers} activeTargetIds={["layer-1"]} progress={1}/>);
  expect(first).toContain('data-layer-detail="layer-2" data-layer-reveal="0" opacity="0"');
  const second = renderToStaticMarkup(<TeachingDisplay block={layers} activeTargetIds={["layer-2"]} progress={.36}/>);
  expect(second).toContain('data-layer-detail="layer-1" data-layer-reveal="1" opacity="1"');
  expect(second).toContain('data-layer-detail="layer-3" data-layer-reveal="0" opacity="0"');
  expect(second).toContain('data-layer-reveal="0.5"');
});

test("water cycle holds the spoken path at its exact end boundary and on repeated cues, with reversible positions", () => {
  const water: MaterialTeaching = {...block, templateId: "geography-water", content: {
    title: "水循环", nodes: ["海洋", "水汽", "云", "雨", "河流"].map(label => ({label, glyph: "water"})) as [
      {label: string; glyph: "water"}, {label: string; glyph: "water"}, {label: string; glyph: "water"},
      {label: string; glyph: "water"}, {label: string; glyph: "water"},
    ], transitions: ["蒸发", "凝结", "降水", "汇流", "入海"], stages: ["观察", "迁移", "核对"], note: "同一份水继续迁移。",
  }};
  const intervals = ["path-1", "path-2", "path-3", "path-3", "path-4", "path-5"].map((id, index) => ({targetIds: [id], startTick: index * 480_000, durationTicks: 480_000}));
  const render = (tick: number) => renderToStaticMarkup(<TeachingDisplay block={water} timeline={{intervals, tick}}/>);
  const active = (html: string) => [...html.matchAll(/data-cycle-path="([^"]+)" data-cycle-active="true"/g)].map(match => match[1]);
  const particle = (html: string) => html.match(/data-cycle-particle="true" cx="([^"]+)" cy="([^"]+)"/)?.slice(1).map(Number);
  // This exact 7.2 s grammar endpoint used to light path-4 while path-3 spoke.
  for (const tick of [960_000 + 345_600, 1_439_999, 1_440_000, 1_919_999]) {
    const html = render(tick);
    expect(active(html)).toEqual(["path-3"]);
    expect(particle(html)).toEqual([824, 284]);
  }
  const middleTick = 960_000 + 172_800, before = render(middleTick);
  expect(particle(before)).toEqual([723, 204]);
  expect(active(render(1_920_000))).toEqual(["path-4"]);
  expect(particle(render(1_920_000))).toEqual([824, 284]);
  render(2_600_000);
  expect(render(middleTick)).toBe(before);
  // Existing films still use their original absolute grammar clock.
  const legacy = renderToStaticMarkup(<DisciplineScene id="geography-water" config={water.content} frame={7.2 * 60} fps={60}/>);
  expect(active(legacy)).toEqual(["path-4"]);
  expect(particle(legacy)).toEqual([824, 284]);
});

test("legacy visual adapters preserve five complete labels/details, real target IDs and bottom-first layer order", () => {
  const source: MaterialVisual = {type: "visual", id: "old_visual", kind: "layers", title: "原有五层结构", items: Array.from({length: 5}, (_, index) => ({id: `part-${index}`, label: `完整层标题 ${index}`, detail: `完整说明 ${index} 必须保留`}))};
  expect(supportsTeachingVisualArt(source)).toBe(true);
  const html = renderToStaticMarkup(<TeachingVisualArt block={source} emphasis={[0, 0, 0, 0, 1]}/>);
  for (const item of source.items) {
    expect(html).toContain(item.label);
    expect(html).toContain(item.detail);
    expect(html).toContain(`data-lp-target="visual:old_visual:${item.id}"`);
  }
  expect(html).toContain('data-layer-object="layer-1" data-lp-target="visual:old_visual:part-4"');
  expect(html).not.toContain('undefined');
  const flow = {...source, kind: "process" as const};
  const processHtml = renderToStaticMarkup(<TeachingVisualArt block={flow} emphasis={[0, 0, 1, 0, 0]}/>);
  for (const item of flow.items) expect(processHtml).toContain(item.detail);
  expect(supportsTeachingVisualArt({...source, items: [{...source.items[0]!, label: "$x^2$"}, ...source.items.slice(1)]})).toBe(false);
});

test("flow transfer advances on the narration clock while completed and repeated node cues keep their reveal state", () => {
  const flow: MaterialTeaching = {...block, templateId: "general-flow", content: {nodes: ["输入", "处理", "输出"], caption: "沿箭头传递"}};
  const intervals = ["node-1", "node-2", "node-2", "node-3"].map((id, index) => ({targetIds: [id], startTick: index * 480_000, durationTicks: 480_000}));
  const at = (tick: number) => renderToStaticMarkup(<TeachingDisplay block={flow} timeline={{intervals, tick}}/>);
  const a = at(900_000), b = at(912_000);
  const particles = flowParticleGeometry;
  expect(particles(a)).not.toEqual(particles(b));
  const reveals = (html: string) => [...html.matchAll(/data-teaching-node="([^"]+)" data-node-reveal="([^"]+)"/g)].map(match => match.slice(1));
  expect(reveals(a)).toEqual([["node-1", "1"], ["node-2", "1"], ["node-3", "0"]]);
  expect(reveals(b)).toEqual(reveals(a));
  expect(reveals(at(1_100_000))).toEqual(reveals(a));
  expect(particles(at(1_100_000))).not.toEqual(particles(at(1_112_000)));
  at(1_800_000);
  expect(at(900_000)).toBe(a);
  expect(at(900_000)).toBe(a);
});
