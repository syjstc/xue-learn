import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {StateStore, parsePosition} from './lib/state-store.mjs';
import {ModelBridge} from './lib/model-bridge.mjs';
import {LearningRuntime} from './lib/runtime-host.mjs';
import {executeOperation} from './lib/operations.mjs';
import packageMetadata from './package.json' with {type: 'json'};

export const inject = ['llm', 'agentDefaultModel', 'sessions', 'sessionPersistence', 'tools', 'connection'];
const TOOL_PARAMETERS = {
  type: 'object', additionalProperties: false,
  properties: {
    action: {type: 'string', enum: ['list_goals', 'create_goal', 'plan_goal', 'approve_plan', 'get_goal', 'read_lesson', 'generate_reading', 'follow_up', 'practice', 'generate_practice', 'submit_practice', 'reviews']},
    goalId: {type: 'string'}, unitId: {type: 'string'}, sectionId: {type: 'string'}, attemptId: {type: 'string'},
    payload: {type: 'object', additionalProperties: true},
  }, required: ['action'],
};
const json = (value, status = 200) => new Response(JSON.stringify(value), {status,
  headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
async function readJson(request) {
  const text = await request.text();
  if (Buffer.byteLength(text) > 1_000_000) throw Error('Plugin request is too large');
  return JSON.parse(text || '{}');
}

/** Exact Connection routes are authenticated, owner-only, and work over Web and Desktop IPC. */
export function createCarrierHandler({store, models, runtime}) {
  return async request => {
    if (request.headers.get('x-xuelearn-client') !== 'dsh-plugin') return json({message: 'Open the XueLearn learning panel.'}, 403);
    try {
      const path = new URL(request.url).searchParams.get('path');
      if (path === '/xuelearn/host/position') {
        if (request.method === 'GET') return json((await store.read()).position ?? {});
        if (request.method === 'POST') {
          const position = parsePosition(await readJson(request)); await store.update({position});
          return json(position);
        }
      }
      if (path === '/xuelearn/host/status' && request.method === 'GET') {
        await runtime.start();
        return json({...runtime.status, selection: await models.selection().catch(() => null),
          modelOwner: 'dsh', logOwner: 'dsh-sessions', lastModelSessionId: models.lastSessionId ?? null, version: packageMetadata.version});
      }
      const headers = {};
      for (const name of ['content-type', 'accept', 'last-event-id', 'x-course-presentation-capabilities']) {
        const value = request.headers.get(name); if (value) headers[name] = value;
      }
      return await runtime.request(path, {
        method: request.method, headers, signal: request.signal,
        ...(['GET', 'HEAD'].includes(request.method) ? {} : {body: request.body}),
      });
    } catch (error) { return json({message: error.message}, 502); }
  };
}

/** DSH is the host and model owner; Core retains the learning workflow and storage. */
export function apply(ctx, config = {}) {
  const dataPath = resolve(config.dataPath ?? join(process.env.DSH_PROFILE_DIR ?? join(homedir(), '.dsh', 'xuelearn'), 'data', 'xuelearn'));
  const store = new StateStore(dataPath);
  const log = ctx.logger?.('xuelearn') ?? console;
  const models = new ModelBridge({llm: ctx.llm, defaultModel: ctx.agentDefaultModel,
    sessions: ctx.sessions, persistence: ctx.sessionPersistence, cwd: dataPath, log});
  const runtime = new LearningRuntime({dataPath, models, log});
  ctx.effect(() => () => runtime.stop());
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/xuelearn', methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    requestBody: 'buffered', fetch: createCarrierHandler({store, models, runtime}),
  }));
  ctx.effect(() => ctx.tools.register({
    name: 'xuelearn',
    description: 'Use XueLearn Core for durable personal learning. First list_goals or create_goal with payload={title:string,level?:string,generationOptions?:string}; default level is zero. Creation returns goalId only: next call plan_goal with that goalId and payload={planningMode:"fast"} to generate the V2 curriculum plan, then approve_plan to queue its modules. get_goal returns actual module/lesson IDs as preparation completes; read_lesson returns sections and immutable reading documents; generate_reading needs unitId and sectionId. follow_up payload={message:string,anchor:{scope:"block",sectionId,reading:{documentId,blockId}},quotedText?:string,threadId?:string}; use IDs from read_lesson, and preserve the returned threadId for continuation. practice reads Core diagnostics; generate_practice generates questions; submit_practice needs unitId,attemptId,payload={answers:{[questionId]:answer}}. reviews lists due cards. The XueLearn panel provides reading, demonstrations and exercises. Never invent IDs, answers, or completed learning evidence.',
    parameters: TOOL_PARAMETERS,
    output: {schema: {type: 'object', additionalProperties: true}, render: (_args, value) => [{type: 'text', text: JSON.stringify(value)}]},
    execute: (args, execution) => executeOperation(runtime, args, execution.signal),
  }));
}
