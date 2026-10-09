import type {WorkspaceServiceLifecycle} from "./workspace-service-lifecycle.ts";
import { Body, Controller, Delete, Get, Inject, Param, Post } from "@nestjs/common";
import { workspaceServiceSessionRequestSchema } from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";
import {configuredWorkspaceClientCapabilities} from "./workspace-client-permissions.ts";
import type { WorkspaceServiceSessions } from "./workspace-service-sessions.ts";
export const LOCAL_WORKSPACE_SERVICE_CONTEXT = Symbol("LOCAL_WORKSPACE_SERVICE_CONTEXT");
export type LocalWorkspaceServiceContext = { sessions: WorkspaceServiceSessions; clientPermissionsPath?: string; lifecycle?: WorkspaceServiceLifecycle; storageOwnership?: {canResetData:boolean;hasLegacyExtensions:boolean;retainedExtensionTables:number}; drain?: () => Promise<boolean>; backgroundTaskCount: () => Promise<number> };
@Controller("api/workspace-service")
export class LocalWorkspaceServiceController {
  constructor(@Inject(LOCAL_WORKSPACE_SERVICE_CONTEXT) private readonly context: LocalWorkspaceServiceContext) {}
  @Post("sessions")
  async grant(@Body() body: unknown) {
    const request=workspaceServiceSessionRequestSchema.parse(body);
    const approvedCapabilities=await configuredWorkspaceClientCapabilities(this.context.clientPermissionsPath,request);
    return this.context.sessions.grant(request,{approvedCapabilities});
  }
  @Delete("sessions/:sessionId")
  release(@Param("sessionId") sessionId: string) { this.context.sessions.release(sessionId); return {released: true}; }
  @Post("sessions/:sessionId/renew")
  renew(@Param("sessionId") sessionId: string) { return this.context.sessions.renew(sessionId); }
  @Get("storage-ownership")
  storageOwnership() { return this.context.storageOwnership ?? {canResetData:false,hasLegacyExtensions:true,retainedExtensionTables:null}; }
  @Post("drain")
  async drain() { return {canStop: await this.context.drain?.() ?? false}; }
  @Post("resume")
  resume() { this.context.lifecycle?.resume(); return {accepting:true}; }
  @Get("retention")
  async retention() {
    const backgroundTasks = await this.context.backgroundTaskCount();
    const clientSessions = this.context.sessions.activeCount;
    return {workspaceId: this.context.sessions.workspaceId, epoch: this.context.sessions.epoch,
      clientSessions, backgroundTasks, activeRequests:this.context.lifecycle?.activeRequests??0,
      canStop: clientSessions === 0 && backgroundTasks === 0 && (this.context.lifecycle?.activeRequests??0)===0};
  }
}
