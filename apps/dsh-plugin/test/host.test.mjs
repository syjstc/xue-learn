import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {StateStore, parsePosition} from '../lib/state-store.mjs';
import {ModelBridge, nonThinkingControls} from '../lib/model-bridge.mjs';
import {LearningRuntime, assertLearningPath, workerEnvironment} from '../lib/runtime-host.mjs';
import {operationRequest, executeOperation} from '../lib/operations.mjs';
import {createCarrierHandler} from '../host.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'xuelearn-plugin-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return new StateStore(directory);
}

function modelFixture({llm, selection = {provider: 'host-provider', model: 'host-model'}, flush} = {}) {
  const records = [], persisted = [], live = new Set();
  const sessions = {
    prepare(id, options) {
      const record = {id, header: {id}, options, events: [], append(type, data, metadata = {}) {
        const event = structuredClone({type, data, ...metadata});
        this.events.push(event); return event;
      }};
      records.push(record); return record;
    },
    enter(session) {live.add(session); return () => live.delete(session);},
    announce() {},
    async flush(session) {
      if (flush) return flush(session);
      persisted.push(structuredClone(session.events)); return true;
    },
  };
  const provider = llm;
  const bridge = new ModelBridge({
    llm: {...provider, async prepareCall(config, signal) {
      signal.throwIfAborted();
      return {config, adapterDefaults: {}, stream: options => provider.stream(options)};
    }},
    defaultModel: {currentSelection: () => selection}, sessions,
    persistence: {async create() {return {async flush() {}, async close() {}};}},
    cwd: '/learning-workspace', log: {},
  });
  return {bridge, records, persisted, live, selection};
}

test('worker receives operating-system settings without inheriting provider credentials', () => {
  assert.deepEqual(workerEnvironment({PATH: '/bin', HOME: '/test', DEEPSEEK_API_KEY: 'not-for-worker', CUSTOM_SESSION_TOKEN: 'not-for-worker', NODE_OPTIONS: '--require private-config'}),
    {PATH: '/bin', HOME: '/test', ELECTRON_RUN_AS_NODE: '1'});
});

test('reading position survives a fresh plugin instance without overwriting concurrent writes', async t => {
  const store = await fixture(t);
  await Promise.all([
    store.update({somePreference: 'saved'}),
    store.update({position: parsePosition({goalId: 'goal-1', unitId: 'unit-2', sectionId: 's_1', tab: 'practice'})}),
  ]);
  const restored = await new StateStore(store.directory).read();
  assert.equal(restored.somePreference, 'saved');
  assert.deepEqual(restored.position, {goalId: 'goal-1', unitId: 'unit-2', sectionId: 's_1', tab: 'practice'});
  assert.throws(() => parsePosition({unitId: '../../other'}));
  assert.deepEqual(parsePosition({sectionId: 'mini-test:s_1', tab: 'display'}), {sectionId: 'mini-test:s_1', tab: 'display'});
  assert.throws(() => parsePosition({sectionId: '../../other'}));
});

test('DSH model bridge follows host selection and persists exact native Session inputs before dispatch', async t => {
  const store = await fixture(t), sent = [];
  let options, model;
  const llm = {async *stream(value) {
    options = value;
    assert.ok(Object.isFrozen(options.messages[0].content[0]));
    assert.match(JSON.stringify(model.persisted[0]), /Explain probability/);
    assert.equal(options.sessionId, model.records[0].id);
    yield {type: 'reasoning-delta', index: 0, text: 'private reasoning'};
    yield {type: 'text-delta', index: 1, text: 'Probability '};
    yield {type: 'text-delta', index: 1, text: 'is a measure.'};
    yield {type: 'usage', usage: {inputTokens: 10, outputTokens: 4}};
    yield {type: 'finish', reason: {kind: 'stop'}};
  }};
  await store.update({selection: {provider: 'other', model: 'other'}});
  model = modelFixture({llm, selection: {provider: 'dsh-choice', model: 'dsh-model', reasoningEffort: 'high'}});
  const {bridge} = model;
  await bridge.handle({id: 'call-1', maxTokens: 300, stop: ['END'], messages: [{role: 'system', content: 'Teach carefully'}, {role: 'user', content: 'Explain probability'}]}, value => sent.push(value));
  assert.equal(options.provider, 'dsh-choice');
  assert.equal(options.model, 'dsh-model');
  assert.equal(options.reasoningEffort, 'off');
  assert.equal(model.selection.reasoningEffort, 'high', 'host chat preferences are unchanged');
  assert.equal(options.maxTokens, 300);
  assert.deepEqual(options.stop, ['END']);
  assert.deepEqual(sent.map(s => s.type), ['xuelearn.dsh.llm.chunk', 'xuelearn.dsh.llm.chunk', 'xuelearn.dsh.llm.end']);
  assert.equal(options.messages[0].source.kind, 'system-prompt');
  const result = model.persisted.at(-1).find(event => event.type === 'assistant/message');
  assert.equal(result.data.message.content[1].text, 'Probability is a measure.');
  assert.equal(result.data.usage.inputTokens, 10);
  assert.match(JSON.stringify(result.data.stream), /private reasoning/);
  assert.ok(!JSON.stringify(sent).includes('private reasoning'));
  assert.equal(model.live.size, 0);
  assert.ok(!(await readdir(store.directory)).includes('model-journal.jsonl'));
  model.selection.model = 'changed-in-dsh';
  assert.equal((await bridge.selection()).model, 'changed-in-dsh');
});

test('learning calls disable reasoning using exact host model capabilities', () => {
  const controls = {reasoningEffort: 'high', maxTokens: 300};
  assert.deepEqual(nonThinkingControls(controls, {reasoning: {efforts: [{id: 'high'}, {id: 'off'}]}}),
    {reasoningEffort: 'off', maxTokens: 300});
  assert.deepEqual(nonThinkingControls(controls, {}), {maxTokens: 300});
  assert.throws(() => nonThinkingControls(controls, {reasoning: {efforts: [{id: 'high'}]}}), /不支持关闭思考/);
  assert.equal(controls.reasoningEffort, 'high');
});

test('DSH terminal errors and incomplete streams are reported as failures', async t => {
  const store = await fixture(t);
  for (const terminal of [null, {kind: 'error', failure: {message: 'quota exhausted'}}]) {
    const sent = [];
    const {bridge, persisted, live} = modelFixture({llm: {async *stream() { if (terminal) yield {type: 'finish', reason: terminal}; }}});
    await bridge.handle({id: `call-${terminal?.kind ?? 'none'}`, messages: [{role: 'user', content: 'hi'}]}, value => sent.push(value));
    assert.equal(sent.at(-1).type, 'xuelearn.dsh.llm.error');
    assert.ok(!sent.some(s => s.type === 'xuelearn.dsh.llm.end'));
    assert.equal(persisted.at(-1).at(-1).data.reason.kind, 'error');
    assert.equal(live.size, 0);
  }
});

test('DSH tool calls preserve correlation and schema across an authoring round', async t => {
  const store = await fixture(t), sent = [];
  const {bridge, persisted} = modelFixture({llm: {async *stream(options) {
    assert.deepEqual(options.tools, [{name: 'plan', description: '', parameters: {type: 'object'}}]);
    assert.equal(options.messages[1].content[0].type, 'tool-call');
    assert.equal(options.messages[2].toolCallId, 'previous');
    assert.deepEqual(options.messages[2].source, {kind: 'tool', callId: 'previous'});
    yield {type: 'tool-call-delta', index: 0, id: 'next', name: 'plan', argumentsDelta: '{"title":'};
    yield {type: 'tool-call-delta', index: 0, id: 'next', argumentsDelta: '"Equations"}'};
    yield {type: 'block-end', index: 0, block: {type: 'tool-call', id: 'next', name: 'plan', arguments: '{"title":"Equations"}'}};
    yield {type: 'finish', reason: {kind: 'tool-calls'}};
  }}});
  await bridge.handle({id: 'tools', messages: [{role: 'user', content: 'Plan'}, {role: 'assistant', content: '', toolCalls: [{id: 'previous', name: 'plan', args: {}}]}, {role: 'tool', toolCallId: 'previous', content: '{"accepted":true}'}], tools: [{name: 'plan', parameters: {type: 'object'}}], toolChoice: {name: 'plan'}}, value => sent.push(value));
  assert.deepEqual(sent.filter(item => item.type === 'xuelearn.dsh.llm.tool'), [{type: 'xuelearn.dsh.llm.tool', id: 'tools', call: {type: 'tool-call', id: 'next', name: 'plan', args: {title: 'Equations'}}}]);
  assert.equal(sent.at(-1).type, 'xuelearn.dsh.llm.end');
  const records = persisted.at(-1);
  assert.equal(records.find(event => event.type === 'request/header').data.header.tools[0].name, 'plan');
  assert.ok(records.findLast(event => event.type === 'assistant/attempt').data.stream.some(record => record.chunk.block?.id === 'next'));
});

test('Survey arguments cross the bridge before the model finishes', async () => {
  const sent=[]; let release, partial;
  const gate=new Promise(resolve=>{release=resolve;});
  const appeared=new Promise(resolve=>{partial=resolve;});
  const {bridge}=modelFixture({llm:{async *stream(){
    yield {type:'tool-call-delta',index:0,id:'survey',name:'commit_survey',argumentsDelta:'{"items":[{"text":"first"}'};
    await gate;
    yield {type:'tool-call-delta',index:0,argumentsDelta:']}'};
    yield {type:'finish',reason:{kind:'tool-calls'}};
  }}});
  const task=bridge.handle({id:'preview',messages:[{role:'user',content:'preview'}],tools:[{name:'commit_survey',parameters:{type:'object'}}]},value=>{
    sent.push(value);if(value.type==='xuelearn.dsh.llm.tool-delta')partial();
  });
  await appeared;
  assert.match(sent[0].delta.args,/first/);
  assert.ok(!sent.some(value=>value.type==='xuelearn.dsh.llm.end'));
  release();await task;
  assert.equal(sent.at(-1).type,'xuelearn.dsh.llm.end');
});

test('required tools cannot silently complete as plain text', async t => {
  const store = await fixture(t), sent = [];
  const {bridge} = modelFixture({llm: {async *stream() {
    yield {type: 'text-delta', text: 'I will plan.'}; yield {type: 'finish', reason: {kind: 'stop'}};
  }}});
  await bridge.handle({id: 'missing-tool', messages: [{role: 'user', content: 'Plan'}], tools: [{name: 'plan', parameters: {type: 'object'}}], toolChoice: 'required'}, value => sent.push(value));
  assert.equal(sent.at(-1).type, 'xuelearn.dsh.llm.error');
  assert.match(sent.at(-1).error, /required tool/);
});

test('worker cancellation reaches the DSH provider signal', async t => {
  const store = await fixture(t), sent = [];
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const {bridge, persisted, live} = modelFixture({llm: {async *stream({signal}) {
    entered();
    await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true}));
    yield {type: 'finish', reason: {kind: 'aborted', failure: {message: 'Cancelled'}}};
  }}});
  const task = bridge.handle({id: 'cancel-me', messages: [{role: 'user', content: 'slow'}]}, value => sent.push(value));
  await ready; bridge.cancel('cancel-me'); await task;
  assert.equal(sent.at(-1).type, 'xuelearn.dsh.llm.error');
  assert.match(sent.at(-1).error, /Cancelled/);
  assert.equal(persisted.at(-1).at(-1).data.reason.kind, 'aborted');
  assert.equal(live.size, 0);
});

test('a missing DSH default never silently selects a plugin-owned model', async () => {
  const {bridge} = modelFixture({selection: {provider: '', model: ''}});
  await assert.rejects(bridge.selection(), /default model in DeepSeek Harness/);
});

test('a failed DSH durability checkpoint prevents provider dispatch and releases the session', async () => {
  let dispatched = false;
  const {bridge, live} = modelFixture({llm: {async *stream() {dispatched = true;}},
    flush: () => {throw Error('disk full');}});
  const sent = [];
  await bridge.handle({id: 'disk-full', messages: [{role: 'user', content: 'hi'}]}, value => sent.push(value));
  assert.equal(dispatched, false);
  assert.equal(sent.at(-1).type, 'xuelearn.dsh.llm.error');
  assert.match(sent.at(-1).error, /disk full/);
  assert.equal(live.size, 0);
});

test('authenticated Connection carrier forwards only learning APIs without exposing the worker token', async t => {
  const store = await fixture(t), calls = [];
  const handler = createCarrierHandler({store, models: {}, runtime: {request: async (path, options) => {
    assertLearningPath(path); calls.push({path, options});
    return new Response('{"goal":"g1"}', {headers: {'content-type': 'application/json'}});
  }}});
  const request = (path, headers = {'x-xuelearn-client': 'dsh-plugin'}) => new Request('http://host/api/xuelearn?path=' + encodeURIComponent(path), {headers});
  assert.equal((await handler(request('/api/goals', {}))).status, 403);
  const response = await handler(request('/api/goals'));
  assert.deepEqual(await response.json(), {goal: 'g1'});
  assert.equal(calls[0].path, '/api/goals');
  assert.equal(calls[0].options.headers.authorization, undefined);
  assert.equal((await handler(request('/api/teaching-personas'))).status, 200);
  const personaWrite = new Request('http://host/api/xuelearn?path=' + encodeURIComponent('/api/teaching-personas'), {
    method: 'POST', headers: {'x-xuelearn-client': 'dsh-plugin', 'content-type': 'application/json'}, body: '{}',
  });
  assert.equal((await handler(personaWrite)).status, 200);
  assert.equal((await handler(request('/api/workspace-service/drain'))).status, 502);
});

test('learning proxy blocks workspace administration and URL traversal', () => {
  for (const path of ['/api/units/unit-1/reading', '/api/goals?view=full', '/api/reviews/due', '/api/agent/goal-creation-sessions/active', '/api/teaching-personas', '/api/learning-spaces', '/api/learning-spaces/space-1/items', '/api/agent/threads', '/api/agent/threads/thread-1/message', '/api/learning-trajectory/mainline', '/api/profile/learner', '/api/settings/learning-view', '/api/settings/client-preferences']) assert.doesNotThrow(() => assertLearningPath(path));
  for (const path of ['/api/agent/admin', '/api/settings/llm', '/api/settings/client-preferences/private', '/api/teaching-personas-admin', '/api/workspace-service/drain', '/api/local/personal-sync/runtime/disable', '/api/goals/../workspace-service', '//other.example/api/goals', '/api/goals/%2e%2e/workspace-service']) assert.throws(() => assertLearningPath(path));
});

test('agent operations preserve Core API identity and propagate error responses', async () => {
  assert.deepEqual(operationRequest({action: 'create_goal', payload: {title: 'Statistics'}}), {method: 'POST', path: '/api/goals', body: {title: 'Statistics'}});
  assert.deepEqual(operationRequest({action: 'plan_goal', goalId: 'g1', payload: {planningMode: 'fast'}}), {method: 'POST', path: '/api/goals/g1/plan/stream', body: {planningMode: 'fast'}});
  assert.deepEqual(operationRequest({action: 'approve_plan', goalId: 'g1'}), {method: 'POST', path: '/api/goals/g1/plan', body: {}});
  assert.equal(operationRequest({action: 'generate_reading', unitId: 'u1', sectionId: 's1'}).path, '/api/units/u1/reading/sections/s1/generate');
  assert.throws(() => operationRequest({action: 'submit_practice', unitId: 'u1'}), /attemptId/);
  const runtime = {request: async () => new Response(JSON.stringify({message: 'unit not found'}), {status: 404})};
  await assert.rejects(() => executeOperation(runtime, {action: 'read_lesson', unitId: 'missing'}), /404.*unit not found/);
  const failedStream = {request: async () => new Response('data: {"type":"error","message":"planning failed"}\n\n', {headers: {'content-type': 'text/event-stream'}})};
  await assert.rejects(() => executeOperation(failedStream, {action: 'plan_goal', goalId: 'g1'}), /planning failed/);
});

test('get_goal opens V2 readiness and returns only startable lessons with their persisted content', async () => {
  const calls = [], signal = new AbortController().signal;
  const bodies = {
    '/api/goals/g1?view=journey': {goal: {curriculumVersion: 2, currentModuleId: 'm1', modules: [
      {id: 'm1', unlockStatus: 'unlocked'}, {id: 'm2', unlockStatus: 'locked'},
    ]}},
    '/api/goals/g1/modules/m1': {module: {id: 'm1', unlockStatus: 'unlocked', units: [
      {id: 'u1', learnable: true, sections: [{id: 's1'}]}, {id: 'u2', learnable: false},
    ]}},
    '/api/goals/g1?view=full': {goal: {id: 'g1', units: [
      {id: 'u1', learningMaterial: {introduction: 'Saved lesson'}}, {id: 'u2'},
    ]}},
  };
  const runtime = {request: async (path, options) => {
    assert.equal(options.signal, signal); calls.push(path);
    assert.ok(bodies[path], `unexpected call ${path}`);
    return Response.json(bodies[path]);
  }};
  const result = await executeOperation(runtime, {action: 'get_goal', goalId: 'g1'}, signal);
  assert.deepEqual(calls, Object.keys(bodies));
  assert.equal(result.data.goal.units.length, 1);
  assert.equal(result.data.goal.units[0].id, 'u1');
  assert.equal(result.data.goal.units[0].learningMaterial.introduction, 'Saved lesson');
  assert.equal(result.data.goal.units[0].sections[0].id, 's1');
  assert.equal(result.data.goal.modules[1].unlockStatus, 'locked');
});

test('get_goal surfaces readiness errors and preserves legacy course content', async () => {
  const failed = {request: async () => Response.json({message: 'module failed'}, {status: 503})};
  await assert.rejects(() => executeOperation(failed, {action: 'get_goal', goalId: 'g1'}), /503.*module failed/);
  const full = {goal: {id: 'legacy', units: [{id: 'u1'}]}};
  const runtime = {request: async path => Response.json(path.endsWith('journey') ? {goal: {curriculumVersion: 1}} : full)};
  assert.deepEqual((await executeOperation(runtime, {action: 'get_goal', goalId: 'legacy'})).data, full);
});

test('runtime startup is shared by concurrent callers and shutdown stops its child', async () => {
  const children = [];
  class Child extends EventEmitter {
    connected = true;
    send(message) { this.last = message; }
    kill(signal = 'SIGTERM') { this.connected = false; queueMicrotask(() => this.emit('exit', null, signal)); }
  }
  const runtime = new LearningRuntime({dataPath: '/tmp/test-only', models: {dispose() {}}, forkProcess() { const child = new Child(); children.push(child); return child; }});
  const first = runtime.start(), second = runtime.start();
  assert.equal(children.length, 1);
  assert.equal(children[0].last.type, 'xuelearn.dsh.start');
  assert.match(children[0].last.token, /^[a-f0-9]{64}$/);
  children[0].emit('message', {type: 'xuelearn.dsh.ready', port: 3001});
  assert.deepEqual(await first, await second);
  await runtime.stop();
  await assert.rejects(() => runtime.start(), /disabled/);
});
