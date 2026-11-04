import {createContext, useContext, type ReactNode} from 'react';
import type {MaterialAnchor} from '@xue-learn/core/shared/domain/material-anchor';

type Selection = {anchor: MaterialAnchor; goalId: string; threadId?: string};
type AssistantBridge = {
  openUnitFollowUp(unitId: string, ownerId: string, selection: Selection): void;
  closeUnitFollowUp(ownerId: string): void;
};
const Context = createContext<AssistantBridge | null>(null);
export function AssistantBridgeProvider({children, bridge}: {children: ReactNode; bridge: AssistantBridge}) {
  return <Context.Provider value={bridge}>{children}</Context.Provider>;
}
export function useAssistant(): AssistantBridge {
  const bridge = useContext(Context);
  if (!bridge) throw new Error('Learning assistant bridge is missing');
  return bridge;
}
