import type { CourseSourceSnapshotV1 } from "../../../runtime-contracts/src/index.js";

/** Complete, owner-scoped published course reads. No tool project or learning writes. */
export interface CourseSourceReadPort {
  readCatalog(input: { workspaceId: string; ownerId: string }): Promise<readonly Record<string, unknown>[]>;
  readUnit(input: { workspaceId: string; ownerId: string; unitId: string }): Promise<CourseSourceSnapshotV1 | null>;
  readAsset(input: { ownerId: string; unitId: string; resourceId: string; sha256: string }): Promise<{ data: Uint8Array; mediaType: string } | null>;
}
