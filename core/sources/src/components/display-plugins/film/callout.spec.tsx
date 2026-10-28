import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CalloutDisplay} from './callout.js';
import {materialDisplayDocument} from '../adapters.js';
import {createDisplayClock} from '../../../../libs/display/src/clock.js';
import type {DisplayRendererProps} from '../../display-runtime/index.js';
import {activeDisplayTargets,type DisplayTimelineCue} from '../../../../libs/display/src/index.js';
jest.mock('./callout.css', () => ({}));
jest.mock('./stage.css', () => ({}));
jest.mock('./lesson-board.css', () => ({}));
jest.mock('../../course-display/presentation-stage.css', () => ({}));
jest.mock('../../markdown/prose-markdown.js', () => ({ProseMarkdown: ({content}: {content: string}) => <p>{content}</p>}));
jest.mock('./text.js', () => ({StoryText: ({text}: {text: string}) => <span>{text}</span>}));

const block = {type: 'callout', id: 'fact', variant: 'definition', title: 'Accepted title', body: 'First accepted statement.\n\nSecond accepted statement.\n\nThird accepted statement.'};
function render(active: string[], previous: string[], progress: number, revealed = active, previousRevealed = previous) {
  const document = materialDisplayDocument(block, {activeTargetIds: active, previousActiveTargetIds: previous, revealedTargetIds: revealed, previousRevealedTargetIds: previousRevealed, progress});
  return renderToStaticMarkup(<CalloutDisplay {...({node: document.root, activeTargets: [], clock: createDisplayClock(0), mode: 'video', viewport: {width: 1517, height: 778}, state: {}, updateState() {}, children: null, slots: {}, resources: {}, timeline: []} as DisplayRendererProps)}/>);
}
it('preserves the callout domain, full Markdown and numbered fixed rows', () => {
  const document = materialDisplayDocument(block);
  expect(document.root.kind).toBe('general:callout');
  expect(document.root.payload).toMatchObject({block});
  const html = render(['fact:detail-1'], [], 1);
  expect(html).toContain('data-presentation="film"');
  expect(html).toContain('data-reserved-space="true"');
  for (const part of ['First accepted statement.', 'Second accepted statement.', 'Third accepted statement.']) expect(html).toContain(part);
  expect(html).toContain('data-detail-id="fact:detail-1" data-detail-number="01" data-active="true" data-pending="false"');
  expect(html).toContain('data-detail-id="fact:detail-3" data-detail-number="03" data-active="false" data-pending="true"');
});
it('samples travel and reveal deterministically, preserving prior rows and reverse seeks', () => {
  const halfway = () => render(['fact:detail-2'], ['fact:detail-1'], .5, ['fact:detail-1', 'fact:detail-2'], ['fact:detail-1']);
  const html = halfway();
  expect(html).toContain('data-focus-travel="true"');
  expect(html).toContain('--detail-reveal:0.5;--detail-emphasis:0.5');
  expect(html).toContain('data-detail-id="fact:detail-1" data-detail-number="01" data-active="false" data-pending="false"');
  render(['fact:detail-3'], ['fact:detail-2'], 1, ['fact:detail-1', 'fact:detail-2', 'fact:detail-3']);
  expect(halfway()).toBe(html);
});

function renderNative(timeline:readonly DisplayTimelineCue[],tick:number){
  // The Display node and accepted block deliberately have different IDs.
  const node={...materialDisplayDocument(block).root,id:'board'};
  const clock=createDisplayClock(tick/800,60,48_000);
  return renderToStaticMarkup(<CalloutDisplay {...({node,activeTargets:activeDisplayTargets(timeline,clock),clock,mode:'video',state:{},updateState(){},children:null,slots:{},resources:{},timeline} as DisplayRendererProps)}/>);
}
const pendingRows=(html:string)=>[...html.matchAll(/data-pending="true"/g)].length;
it('reveals every accepted row when native narration targets the whole Display node',()=>{
  const timeline=[{id:'whole-board',startTick:48_000,durationTicks:96_000,targets:['board']}];
  expect(pendingRows(renderNative(timeline,24_000))).toBe(3);
  const visited=renderNative(timeline,96_000);
  expect(pendingRows(visited)).toBe(0);
  for(const text of ['First accepted statement.','Second accepted statement.','Third accepted statement.'])expect(visited).toContain(text);
  expect(pendingRows(renderNative(timeline,160_000))).toBe(0);
  expect(renderNative(timeline,96_000)).toBe(visited);
});
it('preserves specific detail builds when a cue also includes its parent node',()=>{
  const timeline=[
    {id:'first-row',startTick:0,durationTicks:96_000,targets:['board','board/fact:detail-1']},
    {id:'second-row',startTick:96_000,durationTicks:96_000,targets:['board','board/fact:detail-2']},
    {id:'overview',startTick:192_000,durationTicks:96_000,targets:['board']},
  ];
  const first=renderNative(timeline,48_000);
  expect(pendingRows(first)).toBe(2);
  expect(pendingRows(renderNative(timeline,144_000))).toBe(1);
  expect(pendingRows(renderNative(timeline,240_000))).toBe(0);
  expect(renderNative(timeline,48_000)).toBe(first);
});
