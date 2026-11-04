import type {TeachingPersona} from './index.js';
import type {PersonaPromptLocale} from './instructions.js';

export type HostTeachingPersonaContext = {
  userId: string;
  goalId?: string;
  locale: PersonaPromptLocale;
};
export type HostTeachingPersonaResolver = (context: HostTeachingPersonaContext) =>
  TeachingPersona | undefined | Promise<TeachingPersona | undefined>;
const resolvers: Array<{resolve: HostTeachingPersonaResolver}> = [];

/** A process-owned identity never rewrites saved learner or goal preferences. */
export function registerHostTeachingPersonaResolver(resolve: HostTeachingPersonaResolver): () => void {
  const entry = {resolve};
  resolvers.push(entry);
  return () => {
    const index = resolvers.indexOf(entry);
    if (index !== -1) resolvers.splice(index, 1);
  };
}

export async function resolveHostTeachingPersona(context: HostTeachingPersonaContext) {
  for (let index = resolvers.length - 1; index >= 0; index--) {
    const persona = await resolvers[index].resolve(context);
    if (persona) return persona;
  }
  return undefined;
}
