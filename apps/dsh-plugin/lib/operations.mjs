function id(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw Error(`${label} is required`);
  return encodeURIComponent(value);
}
export function operationRequest(args) {
  const payload = args.payload ?? {};
  switch (args.action) {
    case 'list_goals': return {path: '/api/goals'};
    case 'create_goal': return {method: 'POST', path: '/api/goals', body: payload};
    case 'plan_goal': return {method: 'POST', path: `/api/goals/${id(args.goalId, 'goalId')}/plan/stream`, body: payload};
    case 'approve_plan': return {method: 'POST', path: `/api/goals/${id(args.goalId, 'goalId')}/plan`, body: {}};
    case 'get_goal': return {path: `/api/goals/${id(args.goalId, 'goalId')}?view=full`};
    case 'read_lesson': return {path: `/api/units/${id(args.unitId, 'unitId')}/reading`};
    case 'generate_reading': return {method: 'POST', path: `/api/units/${id(args.unitId, 'unitId')}/reading/sections/${id(args.sectionId, 'sectionId')}/generate`, body: payload};
    case 'follow_up': return {method: 'POST', path: `/api/units/${id(args.unitId, 'unitId')}/follow-ups/stream`, body: payload};
    case 'practice': return {path: `/api/units/${id(args.unitId, 'unitId')}/diagnostic`};
    case 'generate_practice': return {method: 'POST', path: `/api/units/${id(args.unitId, 'unitId')}/diagnostic/stream`, body: payload};
    case 'submit_practice': return {method: 'POST', path: `/api/units/${id(args.unitId, 'unitId')}/diagnostic/${id(args.attemptId, 'attemptId')}/submit`, body: payload};
    case 'reviews': return {path: '/api/reviews/due'};
    default: throw Error('Unknown learning action');
  }
}

export async function executeOperation(runtime, args, signal) {
  const request = operationRequest(args);
  if (args.action !== 'get_goal') return executeRequest(runtime, request, signal);

  // V2 opens its first cognitive-model generation on journey access. Reading
  // only the full goal leaves a newly approved course waiting indefinitely.
  const base = `/api/goals/${id(args.goalId, 'goalId')}`;
  const journey = await executeRequest(runtime, {path: `${base}?view=journey`}, signal);
  if (journey.data.goal?.curriculumVersion !== 2) return executeRequest(runtime, request, signal);
  const summaries = journey.data.goal.modules ?? [];
  const modules = await Promise.all(summaries.map(async module => module.unlockStatus === 'locked' ? module
    : (await executeRequest(runtime, {path: `${base}/modules/${id(module.id, 'moduleId')}`}, signal)).data.module));
  // Module reads reconcile readiness. Read full content afterwards so its
  // persisted session/material fields reflect that preparation.
  const result = await executeRequest(runtime, request, signal);
  const ready = new Map(modules.flatMap(module => module.units ?? []).filter(unit => unit.learnable).map(unit => [unit.id, unit]));
  result.data.goal = {...result.data.goal, modules,
    currentModuleId: journey.data.goal.currentModuleId,
    journeyProgress: journey.data.goal.journeyProgress,
    units: (result.data.goal.units ?? []).filter(unit => ready.has(unit.id)).map(unit => ({...unit, ...ready.get(unit.id)})),
  };
  return result;
}

async function executeRequest(runtime, request, signal) {
  const response = await runtime.request(request.path, {
    method: request.method, signal,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    headers: {'content-type': 'application/json'},
  });
  let data;
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', total = 0; const events = [];
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        total += next.value.byteLength;
        if (total > 8_000_000) throw Error('Learning stream exceeded its response limit');
        buffer += decoder.decode(next.value, {stream: true});
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) if (line.startsWith('data: ')) {
          const event = JSON.parse(line.slice(6));
          // Tokens are reflected in durable Core content; keep terminal/status events.
          if (event.type === 'error') throw Error(event.message ?? event.error ?? 'Core learning generation failed');
          if (!['token', 'thinking', 'status'].includes(event.type)) events.push(event);
          if (events.length > 50) events.shift();
        }
      }
      data = {events};
    } finally { await reader.cancel(); }
  } else {
    const text = await response.text();
    try { data = JSON.parse(text); } catch { data = {message: text.slice(0, 12000)}; }
  }
  if (!response.ok) throw Error(`Learning API ${response.status}: ${JSON.stringify(data)}`);
  return {status: response.status, data};
}
