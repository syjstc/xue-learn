import { presentationCapabilitiesSchema } from "../../domain/src/presentation-capabilities.js";
import { z } from "zod";
export const WORKSPACE_SERVICE_PROTOCOL_VERSION = 1 as const;
export const workspaceServiceCapabilities = ["course.catalog.read", "course.content.read", "course.assets.read", "course.assessments.read", "learning.progress.read", "learning.answer.submit", "learning.section.complete"] as const;
export const workspaceServiceCapabilitySchema = z.enum(workspaceServiceCapabilities);
export type WorkspaceServiceCapability = z.infer<typeof workspaceServiceCapabilitySchema>;
export const workspaceServiceDiscoverySchema = z.object({
  protocolVersion: z.literal(1), coreContractVersion: z.literal("course-source.v1"),
  workspaceId: z.string().min(1), instanceId: z.string().uuid(), epoch: z.string().uuid(),
  pid: z.number().int().positive(), endpoint: z.string().regex(/^http:\/\/127\.0\.0\.1:\d+$/),
  capabilities: z.array(workspaceServiceCapabilitySchema), startedAt: z.string().datetime(),
}).strict();
export const workspaceServiceSessionRequestSchema = z.object({
  protocolVersion: z.literal(1), workspaceId: z.string().min(1), clientId: z.string().min(1).max(128),
  capabilities: z.array(workspaceServiceCapabilitySchema).min(1),
  presentationCapabilities: presentationCapabilitiesSchema.optional(),
}).strict();
export const workspaceServiceSessionSchema = z.object({
  protocolVersion: z.literal(1), coreContractVersion: z.literal("course-source.v1"),
  workspaceId: z.string().min(1), ownerId: z.string().min(1), instanceId: z.string().uuid(), epoch: z.string().uuid(),
  clientId: z.string().min(1).max(128),
  sessionId: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/),
  presentationCapabilities: presentationCapabilitiesSchema.optional(),
  capabilities: z.array(workspaceServiceCapabilitySchema), expiresAt: z.string().datetime(),
}).strict();
export type WorkspaceServiceDiscovery = z.infer<typeof workspaceServiceDiscoverySchema>;
export type WorkspaceServiceSessionRequest = z.infer<typeof workspaceServiceSessionRequestSchema>;
export type WorkspaceServiceSession = z.infer<typeof workspaceServiceSessionSchema>;
