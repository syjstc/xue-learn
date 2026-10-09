export type ActiveAssistantFollowUp = {
  unitId: string;
  ownerId: string;
};

export function ownsAssistantFollowUp(
  active: ActiveAssistantFollowUp | null,
  unitId: string,
  ownerId: string,
): boolean {
  return active?.unitId === unitId && active.ownerId === ownerId;
}

/**
 * Close only the material view that currently owns the shared assistant panel.
 * Several section materials from one unit can be mounted in the chat course
 * view at the same time, so matching only by unit would let an inactive section
 * close the active section's follow-up.
 */
export function closeOwnedAssistantFollowUp(
  active: ActiveAssistantFollowUp | null,
  ownerId?: string,
): ActiveAssistantFollowUp | null {
  if (ownerId && active?.ownerId !== ownerId) return active;
  return null;
}
