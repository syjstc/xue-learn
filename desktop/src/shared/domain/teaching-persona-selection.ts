export type TeachingPersonaSelectionItem = {
  ref: string;
  kind: "builtin" | "custom";
  avatarCode: string;
};

export type TeachingPersonaSelectionGroup<
  T extends TeachingPersonaSelectionItem,
> = {
  key: string;
  kind: T["kind"];
  personas: T[];
};

export function teachingPersonaArchetypeKey(
  persona: TeachingPersonaSelectionItem,
) {
  if (persona.kind === "custom") return persona.ref;
  return persona.avatarCode.replace(/_female$/, "");
}

export function groupTeachingPersonas<T extends TeachingPersonaSelectionItem>(
  personas: readonly T[],
): TeachingPersonaSelectionGroup<T>[] {
  const groups = new Map<string, TeachingPersonaSelectionGroup<T>>();
  for (const persona of personas) {
    const key = teachingPersonaArchetypeKey(persona);
    const existing = groups.get(key);
    if (existing) existing.personas.push(persona);
    else groups.set(key, { key, kind: persona.kind, personas: [persona] });
  }
  return [...groups.values()];
}

export function preferredPersonaForGroup<
  T extends TeachingPersonaSelectionItem,
>(
  group: TeachingPersonaSelectionGroup<T>,
  preferredRef?: string | null,
  activeRef?: string | null,
) {
  return (
    group.personas.find((persona) => persona.ref === preferredRef) ??
    group.personas.find((persona) => persona.ref === activeRef) ??
    group.personas[0]
  );
}
