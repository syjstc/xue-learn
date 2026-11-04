import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {consumeEventStream, AuthenticatedEventSource} from '../lib/event-stream.mjs';

const encoder = new TextEncoder();

test('JIT reading snapshots arrive before stream completion across split UTF-8 and CRLF frames', async () => {
  let stream, finished = false;
  const response = new Response(new ReadableStream({start(controller) {stream = controller;}}));
  const received = [];
  const consuming = consumeEventStream(response, message => {
    assert.equal(finished, false);
    received.push(message);
  });
  const frame = encoder.encode(': heartbeat\r\nid: 1\r\ndata: {"text":"第一段"}\r\n\r\n');
  for (const byte of frame) stream.enqueue(Uint8Array.of(byte));
  await delay(0);
  assert.equal(received[0].data, '{"text":"第一段"}');
  assert.equal(received[0].lastEventId, '1');
  stream.enqueue(encoder.encode('data: {"figure":"ready"}\n\n'));
  await delay(0);
  assert.equal(received.length, 2);
  finished = true;
  stream.close();
  await consuming;
});

test('the authenticated event source reconnects with its cursor and closes its live reader', async () => {
  const calls = [], messages = [];
  let cancelled = false;
  const source = new AuthenticatedEventSource('/api/units/u/reading/events', {retryMs: 1,
    async fetch(path, init) {
      calls.push({path, init});
      return new Response(new ReadableStream({start(controller) {
        controller.enqueue(encoder.encode(`id: ${calls.length}\ndata: {"snapshot":${calls.length}}\n\n`));
        if (calls.length === 1) controller.close();
      }, cancel() {cancelled = true;}}));
    }});
  source.onmessage = message => {messages.push(message); if (messages.length === 2) source.close();};
  for (let i = 0; i < 50 && messages.length < 2; i++) await delay(2);
  source.close();
  await delay(0);
  assert.equal(messages.length, 2);
  assert.equal(calls[0].init.headers.Accept, 'text/event-stream');
  assert.equal(calls[1].init.headers['Last-Event-ID'], '1');
  assert.ok(calls[1].init.signal.aborted);
  assert.ok(cancelled);
  const count = calls.length;
  await delay(5);
  assert.equal(calls.length, count, 'closed sources never reconnect');
});
