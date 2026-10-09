import type {WorkspaceServiceLifecycle} from "./workspace-service-lifecycle.ts";
import { runWithPresentationCapabilities } from "@xue-learn/core/server/llm/display-capabilities";
import { presentationCapabilitiesSchema } from "@xue-learn/core/domain/presentation-capabilities";
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import {
  LOCAL_OWNER_ID,
  classifyPersonalSyncLeaseRequest,
  localRoutePolicy,
  type PersonalSyncLeaseTarget,
} from "@xue-learn/core/runtime-contracts";
import type { WorkspaceServiceSessions } from "./workspace-service-sessions.ts";
import { runWithPersonalSyncCapture } from "@xue-learn/core/server/personal-sync";

const FORGED_IDENTITY_HEADERS = [
  "x-user-id",
  "x-user-name",
  "x-user-role",
  "x-user-roles",
  "x-runtime-role",
  "x-workspace-session-id",
  "x-course-presentation-capabilities",
] as const;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function tokenMatches(candidate: string | undefined, expected: string): boolean {
  return timingSafeEqual(digest(candidate ?? ""), digest(expected));
}

function isForbiddenLocalRoute(path: string): boolean {
  return (
    localRoutePolicy.forbiddenExact.includes(path as never) ||
    localRoutePolicy.forbiddenPrefixes.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  );
}

/** Fixed-owner authentication for the private desktop-local process. */
export function createLocalIngressMiddleware(
  expectedToken: string,
  isWorkspaceReadOnly?: () => Promise<boolean>,
  hasValidLease?: (target: PersonalSyncLeaseTarget) => Promise<boolean>,
  sessions?: WorkspaceServiceSessions,
  lifecycle?: WorkspaceServiceLifecycle,
) {
  if (!expectedToken) throw new Error("Local sidecar token must not be empty");

  return (req: Request, res: Response, next: NextFunction): void => {
    const presentationHeader = req.headers["x-course-presentation-capabilities"];
    for (const header of FORGED_IDENTITY_HEADERS) delete req.headers[header];

    const path = (req.originalUrl.split("?")[0] || req.path).replace(/\/$/, "") || "/";
    if (isForbiddenLocalRoute(path)) {
      res.status(404).json({ statusCode: 404, message: "Not Found" });
      return;
    }

    const authorization = req.headers.authorization;
    const candidate = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;
    const hostSession = tokenMatches(candidate, expectedToken);
    const scopedSession = !hostSession && candidate ? sessions?.authorize(candidate, req.method, path) : null;
    if (!hostSession && !scopedSession) {
      res.status(401).json({ statusCode: 401, message: "Invalid local session" });
      return;
    }

    const management = ["/api/workspace-service/storage-ownership", "/api/workspace-service/retention", "/api/workspace-service/drain", "/api/workspace-service/resume"].includes(path);
    if (!management && lifecycle) {
      const release = lifecycle.enter();
      if (!release) { res.status(503).json({statusCode:503,code:"WORKSPACE_SERVICE_DRAINING",message:"Workspace service is draining; reconnect after shutdown"}); return; }
      res.once("finish",release);res.once("close",release);
    }
    let presentationCapabilities = scopedSession?.presentationCapabilities;
    if (hostSession && presentationHeader !== undefined) {
      try { presentationCapabilities = presentationCapabilitiesSchema.parse(JSON.parse(String(presentationHeader))); }
      catch { res.status(400).json({statusCode: 400, code: "PRESENTATION_CAPABILITIES_INVALID", message: "Invalid request presentation capabilities"}); return; }
    }
    const proceed = () => {
      req.headers["x-user-id"] = scopedSession?.ownerId ?? LOCAL_OWNER_ID;
      req.headers["x-user-name"] = "Local Owner";
      req.headers["x-user-role"] = "local-runtime";
      req.headers["x-user-roles"] = hostSession ? "learner,local-administrator" : "learner";
      if (scopedSession) req.headers["x-workspace-session-id"] = scopedSession.sessionId;
      req.headers["x-runtime-role"] = "desktop-local";
      runWithPresentationCapabilities(presentationCapabilities, () => runWithPersonalSyncCapture(next));
    };
    const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
    const operationalControl = path.startsWith("/api/workspace-service/") || path === "/api/local/personal-sync/runtime/disable";
    // Device lifecycle/session controls do not mutate shared learning facts.
    if (operationalControl || !mutating || (!isWorkspaceReadOnly && !hasValidLease)) {
      proceed();
      return;
    }
    void (async () => {
      if (await isWorkspaceReadOnly?.()) return "read_only" as const;
      const target = classifyPersonalSyncLeaseRequest(req.method, path);
      if (target && hasValidLease && !(await hasValidLease(target)))
        return "lease_required" as const;
      return null;
    })()
      .then((reason) => {
        const readOnly = reason === "read_only";
        if (readOnly) {
          res.status(423).json({
            statusCode: 423,
            code: "PERSONAL_SYNC_SCHEMA_INCOMPATIBLE",
            message: "Upgrade XueLearn before editing this synced workspace",
          });
          return;
        }
        if (reason === "lease_required") {
          res.status(423).json({
            statusCode: 423,
            code: "PERSONAL_SYNC_LEASE_REQUIRED",
            message: "This change requires the current device to hold the sync lease",
          });
          return;
        }
        proceed();
      })
      .catch(next);
  };
}
