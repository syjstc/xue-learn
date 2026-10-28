import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { encryptedSyncEnvelopeSchema } from "@xue-learn/core/server/personal-sync";
import { PersonalSyncService } from "@cognilearn/desktop-persistence/personal-sync/personal-sync.service";

const acknowledgementSchema = z.object({
  commitId: z.string().uuid(),
  remoteRecordName: z.string().min(1).max(500),
});
const incomingSchema = z.object({
  commitId: z.string().uuid(),
  ciphertextHash: z.string().regex(/^[a-f0-9]{64}$/),
  envelope: encryptedSyncEnvelopeSchema,
});
const quarantineSchema = z.object({ commitId: z.string().uuid() });
const publishedRecoverySchema = z.object({
  commitIds: z.array(z.string().uuid()).min(1).max(200),
});
const cursorSchema = z.object({ syncToken: z.string().nullable() });
const transportStateSchema = z.object({
  kind: z.enum(["offline", "authentication_required", "error", "clear"]),
  message: z.string().max(2_000).nullable().optional(),
});
const leaseCacheSchema = z.object({
  scopeKey: z.string().min(1).max(300),
  holderDeviceId: z.string().uuid().or(z.literal("")),
  holderDisplayName: z.string().max(120).nullable().optional(),
  fencingEpoch: z.number().int().nonnegative(),
  serverModifiedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  recordChangeTag: z.string().min(1),
  transferRequestedByDeviceId: z.string().uuid().nullable().optional(),
});
const deviceCacheSchema = z.object({
  deviceId: z.string().uuid(),
  appVersion: z.string().min(1).max(100),
  lastSeenAt: z.string().datetime(),
  acknowledgedFrontier: z.record(z.string(), z.number().int().nonnegative()),
});

@Controller("api/local/personal-sync")
export class PersonalSyncController {
  constructor(private readonly sync: PersonalSyncService) {}

  @Get("status")
  status() {
    return this.sync.getStatus();
  }

  @Post("runtime/disable")
  disableRuntime() {
    return this.sync.disableRuntime();
  }

  @Get("device")
  device() {
    return this.sync.getLocalDevice();
  }

  @Get("leases")
  leases() {
    return this.sync.listLeases();
  }

  @Get("devices")
  devices() {
    return this.sync.listDevices();
  }

  @Post("transport/device")
  cacheDevice(@Body() raw: unknown) {
    return this.sync.cacheDevice(deviceCacheSchema.parse(raw));
  }

  @Get("transport/unit-scope")
  unitScope(@Query("unitId") unitId?: string) {
    if (!unitId || unitId.length > 200) throw new Error("Invalid unit ID");
    return this.sync.resolveUnitGoal(unitId);
  }

  @Post("transport/lease")
  cacheLease(@Body() raw: unknown) {
    return this.sync.cacheLease(leaseCacheSchema.parse(raw));
  }

  @Post("now")
  syncNow(@Query("limit") rawLimit?: string) {
    const limit = rawLimit ? Number(rawLimit) : 100;
    return this.sync.finalizeAndListOutgoing(
      Number.isFinite(limit) ? limit : 100,
    );
  }

  @Post("initial-snapshot")
  initialSnapshot() {
    return this.sync.ensureInitialSnapshot();
  }

  @Post("transport/acknowledge")
  acknowledge(@Body() raw: unknown) {
    const input = acknowledgementSchema.parse(raw);
    return this.sync.markUploaded(input.commitId, input.remoteRecordName);
  }

  @Get("transport/published")
  published() {
    return this.sync.listPublishedManifest();
  }

  @Post("transport/published/recover")
  recoverPublished(@Body() raw: unknown) {
    return this.sync.recoverPublishedOutgoing(
      publishedRecoverySchema.parse(raw).commitIds,
    );
  }

  @Post("transport/quarantine")
  quarantine(@Body() raw: unknown) {
    return this.sync.quarantineStaleCommit(
      quarantineSchema.parse(raw).commitId,
    );
  }

  @Post("transport/apply")
  apply(@Body() raw: unknown) {
    return this.sync.applyIncoming(incomingSchema.parse(raw));
  }

  @Get("transport/frontier")
  frontier() {
    return this.sync.getAppliedFrontier();
  }

  @Get("conflicts")
  conflicts() {
    return this.sync.listConflicts();
  }

  @Get("transport/cursor")
  cursor() {
    return this.sync.getTransportCursor();
  }

  @Post("transport/cursor")
  updateCursor(@Body() raw: unknown) {
    return this.sync.setTransportCursor(cursorSchema.parse(raw).syncToken);
  }

  @Post("transport/state")
  transportState(@Body() raw: unknown) {
    return this.sync.reportTransportState(transportStateSchema.parse(raw));
  }
}
