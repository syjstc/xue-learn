import {registerHostTeachingPersonaResolver, resolveHostTeachingPersona} from './host-resolver.js';
import type {TeachingPersona} from './index.js';

const context = {userId: 'learner', locale: 'zh-Hans' as const};
const persona = (name: string) => ({name}) as TeachingPersona;

test('host identity is process-local, newest matching registration wins and disposal restores defaults', async () => {
  expect(await resolveHostTeachingPersona(context)).toBeUndefined();
  const first = registerHostTeachingPersonaResolver(() => persona('学习助手'));
  const second = registerHostTeachingPersonaResolver(({goalId}) => goalId ? persona('Scoped assistant') : undefined);
  try {
    expect((await resolveHostTeachingPersona(context))?.name).toBe('学习助手');
    expect((await resolveHostTeachingPersona({...context, goalId:'goal'}))?.name).toBe('Scoped assistant');
    first(); first();
    expect(await resolveHostTeachingPersona(context)).toBeUndefined();
    expect((await resolveHostTeachingPersona({...context, goalId:'goal'}))?.name).toBe('Scoped assistant');
  } finally {first(); second();}
  expect(await resolveHostTeachingPersona(context)).toBeUndefined();
});
