import type { SyncLeaseScope } from "./personal-sync.js";

export type PersonalSyncLeaseTarget =
  | SyncLeaseScope
  | { kind: "unit"; unitId: string };

export type PersonalSyncLeaseRequestClassifier = (method:string,path:string)=>PersonalSyncLeaseTarget|null;
const hostClassifiers=new Map<string,PersonalSyncLeaseRequestClassifier>();
/** Trusted product hosts add their own routes after Core structural rules. */
export function registerPersonalSyncLeaseRequestClassifier(owner:string,classifier:PersonalSyncLeaseRequestClassifier):()=>void {
  if(!owner.trim())throw new Error("Host route classifier requires an owner");
  hostClassifiers.set(owner,classifier);
  return ()=>{if(hostClassifiers.get(owner)===classifier)hostClassifiers.delete(owner);};
}

const STRUCTURAL_SEGMENTS = /\/(?:plan|map|overview|settings|mastery|units|regenerate|generation|cognitive-model|subdivide|learning-mode)(?:\/|$)/;
const OFFLINE_MERGE_SEGMENTS = /\/(?:session|quiz|attempts?|diagnostic|assessment|review|messages|follow-ups|progress|complete)(?:\/|$)/;

export function classifyPersonalSyncLeaseRequest(
  method: string,
  rawPath: string,
): PersonalSyncLeaseTarget | null {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase()))
    return null;
  const path = rawPath.split("?")[0]?.replace(/\/$/, "") || "/";
  if (path.startsWith("/api/local/personal-sync")) return null;
  if (
    path === "/api/goals" ||
    path.startsWith("/api/goal-creation") ||
    path.startsWith("/api/learning-spaces") ||
    path.startsWith("/api/profile")
  )
    return { kind: "workspace" };

  const goal = path.match(/^\/api\/goals\/([^/]+)(?:\/|$)/);
  if (goal && !path.startsWith("/api/goals/shared/")) {
    if (OFFLINE_MERGE_SEGMENTS.test(path) && !STRUCTURAL_SEGMENTS.test(path))
      return null;
    if (path === `/api/goals/${goal[1]}` || STRUCTURAL_SEGMENTS.test(path))
      return { kind: "goal", goalId: decodeURIComponent(goal[1]) };
  }

  const unit = path.match(/^\/api\/units\/([^/]+)(?:\/|$)/);
  if (unit && STRUCTURAL_SEGMENTS.test(path) && !OFFLINE_MERGE_SEGMENTS.test(path))
    return { kind: "unit", unitId: decodeURIComponent(unit[1]) };
  for(const classifier of hostClassifiers.values()){const target=classifier(method.toUpperCase(),path);if(target)return target;}
  return null;
}
