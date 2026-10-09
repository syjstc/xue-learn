import { createHash, randomBytes, randomUUID } from "node:crypto";
import { workspaceServiceSessionRequestSchema, type WorkspaceServiceCapability, type WorkspaceServiceSessionRequest,
  type WorkspaceServiceSession } from "@xue-learn/core/runtime-contracts";
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const READ_CAPABILITIES: readonly WorkspaceServiceCapability[] = ["course.catalog.read", "course.content.read", "course.assets.read"];
export class WorkspaceServiceSessions {
  private readonly sessions = new Map<string, {session: Omit<WorkspaceServiceSession, "token">; tokenHash: string}>();
  constructor(readonly workspaceId: string, readonly ownerId: string, readonly instanceId: string, readonly epoch: string,
    private readonly now = Date.now, private readonly ttlMs = 5 * 60_000) {}
  grant(raw: WorkspaceServiceSessionRequest, options: {approvedCapabilities?: readonly WorkspaceServiceCapability[]} = {}): WorkspaceServiceSession {
    const request = workspaceServiceSessionRequestSchema.parse(raw);
    if (request.workspaceId !== this.workspaceId) throw new Error("WORKSPACE_SESSION_SCOPE: Requested workspace differs from this service");
    if (request.capabilities.some(capability => !(options.approvedCapabilities ?? READ_CAPABILITIES).includes(capability)))
      throw new Error("WORKSPACE_SESSION_CAPABILITY: Requested capability is not explicitly configured for this client");
    const token = randomBytes(32).toString("hex");
    const session = {protocolVersion: 1 as const, coreContractVersion: "course-source.v1" as const,
      workspaceId: this.workspaceId, ownerId: this.ownerId, instanceId: this.instanceId, epoch: this.epoch,
      ...(request.presentationCapabilities ? {presentationCapabilities: request.presentationCapabilities} : {}),
      clientId: request.clientId, sessionId: randomUUID(), capabilities: [...new Set(request.capabilities)], expiresAt: new Date(this.now() + this.ttlMs).toISOString()};
    this.sessions.set(session.sessionId, {session, tokenHash: digest(token)});
    return {...session, token};
  }
  resolve(token: string): Omit<WorkspaceServiceSession, "token"> | null {
    const tokenHash = digest(token);
    for (const [id, value] of this.sessions) {
      if (Date.parse(value.session.expiresAt) <= this.now()) { this.sessions.delete(id); continue; }
      if (value.tokenHash === tokenHash) return {...value.session};
    }
    return null;
  }
  authorize(token: string, method: string, path: string): Omit<WorkspaceServiceSession, "token"> | null {
    const session = this.resolve(token);
    if (!session) return null;
    if ((method === "DELETE" && path === `/api/workspace-service/sessions/${session.sessionId}`) ||
      (method === "POST" && path === `/api/workspace-service/sessions/${session.sessionId}/renew`)) return session;
    if (method === "POST") {
      const required = /^\/api\/workspace-learning\/units\/[^/]+\/sections\/[^/]+\/answers$/.test(path) ? "learning.answer.submit" :
        /^\/api\/workspace-learning\/units\/[^/]+\/sections\/[^/]+\/complete$/.test(path) ? "learning.section.complete" : null;
      return required && session.capabilities.includes(required) ? session : null;
    }
    if (method !== "GET") return null;
    const learningRead = /^\/api\/workspace-learning\/units\/[^/]+\/assessments$/.test(path) ? "course.assessments.read" :
      /^\/api\/workspace-learning\/units\/[^/]+\/progress$/.test(path) ? "learning.progress.read" : null;
    if (learningRead) return session.capabilities.includes(learningRead) ? session : null;
    const required = /^\/api\/course-sources\/units\/[^/]+\/assets\/[^/]+$/.test(path) ? "course.assets.read" :
      /^\/api\/course-sources\/units\/[^/]+$/.test(path) ? "course.content.read" : path === "/api/course-sources/catalog" ? "course.catalog.read" : null;
    return required && session.capabilities.includes(required) ? session : null;
  }
  release(sessionId: string) { this.sessions.delete(sessionId); }
  renew(sessionId: string) {
    const saved = this.sessions.get(sessionId);
    if (!saved || Date.parse(saved.session.expiresAt) <= this.now()) throw new Error("Workspace session expired");
    saved.session.expiresAt = new Date(this.now() + this.ttlMs).toISOString();
    return {...saved.session};
  }
  get activeCount() { this.resolve(""); return this.sessions.size; }
}
