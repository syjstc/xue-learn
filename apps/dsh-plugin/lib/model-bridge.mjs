import {randomUUID} from 'node:crypto';
import {ModelSession} from './model-session.mjs';

function freezeJson(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freezeJson(item);
    Object.freeze(value);
  }
  return value;
}

/** Resolve against the exact model metadata already loaded by prepareCall. */
export function nonThinkingControls(controls, modelInfo) {
  if (!modelInfo.reasoning) {
    const {reasoningEffort, ...plain} = controls;
    return plain;
  }
  const off = modelInfo.reasoning.efforts.find(effort => effort.id === 'off' || effort.id === 'none');
  if (!off) throw Error('当前模型不支持关闭思考，请选择支持不思考模式的模型。');
  return {...controls, reasoningEffort: off.id};
}

export function prepareMessages(messages, selection) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 300) throw Error('Invalid learning model messages');
  return messages.map(message => {
    if (!['system', 'user', 'assistant', 'tool'].includes(message.role) || typeof message.content !== 'string') throw Error('Unsupported learning model message');
    if (message.role === 'tool' && typeof message.toolCallId !== 'string') throw Error('Tool result has no call ID');
    const calls = message.toolCalls ?? [];
    if (!Array.isArray(calls) || calls.some(call => !call.id || !call.name || !call.args || typeof call.args !== 'object')) throw Error('Invalid learning tool calls');
    return {
      id: randomUUID(), role: message.role,
      content: [...(message.content || !calls.length ? [{type: 'text', text: message.content}] : []),
        ...calls.map(call => ({type: 'tool-call', id: call.id, name: call.name, arguments: JSON.stringify(call.args)}))],
      ...(message.role === 'tool' ? {toolCallId: message.toolCallId} : {}),
      source: message.role === 'assistant'
        ? {kind: 'model', provider: selection.provider, model: selection.model}
        : message.role === 'tool' ? {kind: 'tool', callId: message.toolCallId}
        : {kind: message.role === 'system' ? 'system-prompt' : 'user'},
    };
  });
}

/** All generation uses DSH's live provider service; no provider credentials cross IPC. */
export class ModelBridge {
  #active = new Map();
  constructor({llm, defaultModel, sessions, persistence, cwd, log = console}) {
    this.llm = llm; this.defaultModel = defaultModel;
    this.sessions = sessions; this.persistence = persistence; this.cwd = cwd; this.log = log;
  }
  async selection() {
    const selected = this.defaultModel.currentSelection();
    if (!selected || typeof selected.provider !== 'string' || !selected.provider ||
        typeof selected.model !== 'string' || !selected.model) throw Error('Choose a default model in DeepSeek Harness');
    // Learning content should start streaming immediately, independently of the
    // reasoning preference used by the host's ordinary chat sessions.
    return {provider: selected.provider, model: selected.model, reasoningEffort: 'off'};
  }
  async handle(request, send) {
    const {id} = request;
    if (typeof id !== 'string' || this.#active.has(id)) throw Error('Invalid or repeated learning model request');
    const abort = new AbortController();
    let settled;
    const done = new Promise(resolve => {settled = resolve;});
    this.#active.set(id, {abort, done});
    let text = '', finish, journal;
    const toolCalls = new Map();
    const streamedTools = new Map();
    const blocks = new Map();
    const streamTool = (index, call) => {
      const previous = streamedTools.get(index) ?? {arguments: ''};
      if (!call.arguments.startsWith(previous.arguments)) throw Error('DSH tool arguments changed during streaming');
      const args = call.arguments.slice(previous.arguments.length);
      const id = call.id && call.id !== previous.id ? call.id : undefined;
      const name = call.name && call.name !== previous.name ? call.name : undefined;
      if (args || id || name) send({type: 'xuelearn.dsh.llm.tool-delta', id: request.id,
        delta: {type: 'tool-call-delta', index, args, ...(id ? {id} : {}), ...(name ? {name} : {})}});
      streamedTools.set(index, {...call});
    };
    try {
      const selection = await this.selection();
      const messages = prepareMessages(request.messages, selection);
      const choice = request.toolChoice;
      const named = choice && typeof choice === 'object' ? choice.name : undefined;
      const tools = choice === 'none' ? [] : (request.tools ?? []).filter(tool => !named || tool.name === named)
        .map(tool => ({name: tool.name, description: tool.description ?? '', parameters: tool.parameters}));
      if ((choice === 'required' || named) && !tools.length) throw Error('The required learning tool is not available');
      // DSH 0.2.1 declares schemas but has no toolChoice option. Make the
      // requirement explicit to the model and validate it before returning.
      if (choice === 'required' || named) messages.push({id: randomUUID(), role: 'system', source: {kind: 'system-prompt'},
        content: [{type: 'text', text: named ? `For this response, call the tool ${named}.` : 'For this response, call at least one of the provided tools.'}]});
      const call = await this.llm.prepareCall({...selection,
        ...(Number.isInteger(request.maxTokens) && request.maxTokens > 0 ? {maxTokens: request.maxTokens} : {}),
        ...(Array.isArray(request.stop) && request.stop.every(value => typeof value === 'string') ? {stop: request.stop} : {}),
      }, abort.signal, nonThinkingControls);
      abort.signal.throwIfAborted();
      freezeJson(messages); freezeJson(tools);
      journal = await new ModelSession({sessions: this.sessions, persistence: this.persistence,
        cwd: this.cwd, config: call.config}).open({adapterDefaults: call.adapterDefaults, messages, tools});
      this.lastSessionId = journal.id;
      const options = Object.freeze({...call.config, messages, signal: abort.signal, sessionId: journal.id,
        ...(tools.length ? {tools} : {})});
      // The exact request reaches DSH storage before its provider sees it.
      await journal.flush();
      abort.signal.throwIfAborted();
      this.log.info?.(`[XueLearn] model session ${journal.id}: ${selection.provider}/${selection.model}`);
      for await (const chunk of call.stream(options)) {
        journal.chunk(chunk);
        if (chunk.type === 'text-delta') {
          text += chunk.text;
          const block = blocks.get(chunk.index) ?? {type: 'text', text: ''};
          block.text += chunk.text; blocks.set(chunk.index, block);
          send({type: 'xuelearn.dsh.llm.chunk', id, text: chunk.text});
        } else if (chunk.type === 'reasoning-delta') {
          const block = blocks.get(chunk.index) ?? {type: 'reasoning', text: ''};
          block.text += chunk.text; blocks.set(chunk.index, block);
        } else if (chunk.type === 'tool-call-delta') {
          const call = toolCalls.get(chunk.index) ?? {id: chunk.id, name: '', arguments: ''};
          if (chunk.id) call.id = chunk.id;
          if (chunk.name) call.name = chunk.name;
          call.arguments += chunk.argumentsDelta ?? '';
          toolCalls.set(chunk.index, call);
          streamTool(chunk.index, call);
        } else if (chunk.type === 'block-end') {
          blocks.set(chunk.index, chunk.block);
          if (chunk.block.type === 'tool-call') {
            toolCalls.set(chunk.index, chunk.block);
            streamTool(chunk.index, chunk.block);
          }
        } else if (chunk.type === 'finish') finish = chunk.reason;
      }
      if (!finish) throw Error('The DSH model stream ended without a terminal result');
      if (finish.kind === 'error' || finish.kind === 'aborted') throw Error(finish.failure?.message ?? `DSH model ${finish.kind}`);
      abort.signal.throwIfAborted();
      if ((choice === 'required' || named || finish.kind === 'tool-calls') && !toolCalls.size) throw Error('The DSH model did not return the required tool call');
      const completedCalls = [...toolCalls.values()].map(call => {
        if (!call.id || !tools.some(tool => tool.name === call.name)) throw Error('The DSH model returned an undeclared learning tool');
        const args = JSON.parse(call.arguments || '{}');
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('The DSH model returned invalid tool arguments');
        return {type: 'tool-call', id: call.id, name: call.name, args};
      });
      for (const [index, call] of toolCalls) blocks.set(index, {type: 'tool-call', ...call});
      await journal.finish({content: [...blocks].sort(([a], [b]) => a - b).map(([, block]) => block), finish});
      for (const call of completedCalls) send({type: 'xuelearn.dsh.llm.tool', id, call});
      send({type: 'xuelearn.dsh.llm.end', id, finish});
    } catch (error) {
      try {await journal?.finish({error, aborted: abort.signal.aborted});}
      catch (logError) {this.log.warn?.(`[XueLearn] DSH session log failed: ${logError.message}`);}
      this.log.warn?.(`[XueLearn] model request ${id} failed${journal ? ` (session ${journal.id})` : ''}: ${error.message}`);
      send({type: 'xuelearn.dsh.llm.error', id, error: error.message});
    } finally { this.#active.delete(id); settled(); }
  }
  cancel(id) { this.#active.get(id)?.abort.abort(); }
  async dispose() {
    const active = [...this.#active.values()];
    for (const {abort} of active) abort.abort();
    await Promise.allSettled(active.map(({done}) => done));
  }
}
