import test from 'node:test';
import assert from 'node:assert/strict';
import {modelChannel} from '../runtime/model-channel.ts';

const request = {messages: [{role: 'user', content: 'Explain probability'}], maxTokens: 400, stop: ['END']};
const kind = suffix => `xuelearn.dsh.llm.${suffix}`;

test('IPC carries tool schemas, correlated tool results and completed tool calls', async () => {
  const sent = [], channel = modelChannel(message => sent.push(message));
  const tool = {name: 'plan', description: 'Plan a course', parameters: {type: 'object'}};
  const call = {type: 'tool-call', id: 'tool-1', name: 'plan', args: {title: 'Equations'}};
  const stream = channel.stream({...request, tools: [tool], toolChoice: 'required'});
  const waiting = stream.next(), [{id}] = sent;
  assert.deepEqual(sent[0].tools, [tool]);
  channel.receive({type: kind('tool'), id, call});
  channel.receive({type: kind('end'), id});
  assert.deepEqual(await waiting, {value: call, done: false});
  assert.equal((await stream.next()).done, true);
  channel.close();
});

test('IPC delivers incremental tool arguments while the request is still running', async () => {
  const sent=[],channel=modelChannel(value=>sent.push(value));
  const stream=channel.stream(request), waiting=stream.next(), [{id}]=sent;
  const delta={type:'tool-call-delta',index:0,id:'survey',name:'commit_survey',args:'{"items":['};
  channel.receive({type:kind('tool-delta'),id,delta});
  assert.deepEqual(await waiting,{value:delta,done:false});
  channel.receive({type:kind('end'),id});
  assert.equal((await stream.next()).done,true);channel.close();
});

test('IPC model channel isolates interleaved requests and drains tokens before completion', async () => {
  const sent = [], channel = modelChannel(message => sent.push(message));
  const first = channel.stream(request), second = channel.stream({...request, maxTokens: 900});
  const a1 = first.next(), b1 = second.next();
  assert.equal(sent.length, 2);
  const [a, b] = sent;
  assert.notEqual(a.id, b.id);
  assert.deepEqual(a, {type: kind('request'), id: a.id, ...request});
  assert.equal(b.maxTokens, 900);
  assert.equal(channel.receive({type: 'other.message', id: a.id}), false);
  assert.equal(channel.receive({type: kind('chunk'), id: 'stale-id', text: 'ignored'}), true);
  channel.receive({type: kind('chunk'), id: b.id, text: 'B1'});
  channel.receive({type: kind('chunk'), id: a.id, text: 'A1'});
  assert.deepEqual(await a1, {value: 'A1', done: false});
  assert.deepEqual(await b1, {value: 'B1', done: false});
  channel.receive({type: kind('chunk'), id: a.id, text: 'A2'});
  channel.receive({type: kind('end'), id: a.id});
  channel.receive({type: kind('end'), id: b.id});
  assert.deepEqual(await first.next(), {value: 'A2', done: false});
  assert.deepEqual(await first.next(), {value: undefined, done: true});
  assert.deepEqual(await second.next(), {value: undefined, done: true});
  assert.ok(!sent.some(message => message.type === kind('cancel')));
  channel.close();
});

test('aborting a waiting request wakes its consumer and cancels only its host call', async () => {
  const sent = [], channel = modelChannel(message => sent.push(message));
  const abort = new AbortController();
  const cancelled = channel.stream({...request, signal: abort.signal});
  const survivor = channel.stream(request);
  const waiting = cancelled.next(), surviving = survivor.next();
  const [a, b] = sent;
  assert.ok(!('signal' in a));
  const rejection = assert.rejects(waiting, /cancelled/);
  abort.abort();
  await rejection;
  assert.deepEqual(sent.filter(message => message.type === kind('cancel')), [{type: kind('cancel'), id: a.id}]);
  channel.receive({type: kind('chunk'), id: a.id, text: 'too late'});
  channel.receive({type: kind('chunk'), id: b.id, text: 'still running'});
  channel.receive({type: kind('end'), id: b.id});
  assert.equal((await surviving).value, 'still running');
  assert.equal((await survivor.next()).done, true);
  channel.close();
});

test('an already aborted signal never dispatches a host request', async () => {
  const sent = [], channel = modelChannel(message => sent.push(message));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(channel.stream({...request, signal: abort.signal}).next());
  assert.deepEqual(sent, []);
  channel.close();
});

test('returning early from a token stream cancels the producer and removes the abort listener', async () => {
  const sent = [], channel = modelChannel(message => sent.push(message));
  const abort = new AbortController(), stream = channel.stream({...request, signal: abort.signal});
  const waiting = stream.next(), [{id}] = sent;
  channel.receive({type: kind('chunk'), id, text: 'first'});
  assert.equal((await waiting).value, 'first');
  assert.equal((await stream.return()).done, true);
  abort.abort();
  assert.deepEqual(sent.filter(message => message.type === kind('cancel')), [{type: kind('cancel'), id}]);
  channel.close();
});

test('provider failures terminate the stream without reporting successful completion', async () => {
  const sent = [], channel = modelChannel(message => sent.push(message));
  const stream = channel.stream(request), first = stream.next(), [{id}] = sent;
  channel.receive({type: kind('chunk'), id, text: 'partial'});
  assert.equal((await first).value, 'partial');
  const next = stream.next();
  channel.receive({type: kind('error'), id, error: 'quota exhausted'});
  await assert.rejects(next, /quota exhausted/);
  assert.equal((await stream.next()).done, true);
  assert.ok(!sent.some(message => message.type === kind('cancel')));
  channel.close();
});

test('a disconnected host rejects every pending stream and refuses new requests', async () => {
  const sent = [], channel = modelChannel(message => sent.push(message));
  const first = channel.stream(request).next(), second = channel.stream(request).next();
  const rejected = Promise.all([assert.rejects(first, /host disconnected/), assert.rejects(second, /host disconnected/)]);
  channel.close(); channel.close();
  await rejected;
  await assert.rejects(channel.stream(request).next(), /host disconnected/);
  assert.equal(sent.length, 2);
});

test('a stalled request reports its timeout and cancels the host call', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const sent = [], channel = modelChannel(message => sent.push(message));
  const stream = channel.stream(request), next = stream.next(), [{id}] = sent;
  const rejected = assert.rejects(next, /timed out/);
  t.mock.timers.tick(600_000);
  await rejected;
  assert.deepEqual(sent.filter(message => message.type === kind('cancel')), [{type: kind('cancel'), id}]);
  channel.close();
});
