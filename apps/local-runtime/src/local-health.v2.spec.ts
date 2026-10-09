import type { RuntimeDescriptor } from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";
import type { LearningSpaceOrmProvider } from "@xue-learn/core/source/libs/server/src/learning-spaces/learning-space-orm.provider.ts";
import { LocalHealthController } from "./local-health.controller.ts";

describe("desktop-local health v2", () => {
  it("checks the shared SQLite connection before reporting ready", async () => {
    const checkConnection = jest.fn().mockResolvedValue(undefined);
    const descriptor = {
      schemaVersion: 1,
      kind: "desktop-local",
      os: "macos",
      arch: "arm64",
      appVersion: "test",
      capabilities: {
        authentication: false,
        billing: false,
        publicCatalog: false,
        sharing: false,
        cloudSync: false,
        localAdmin: true,
        nativeFilesystem: true,
        nativeTerminal: false,
      },
    } satisfies RuntimeDescriptor;
    const controller = new LocalHealthController(
      { checkConnection } as unknown as LearningSpaceOrmProvider,
      { instanceId: "instance-1", startedAt: 123, descriptor },
    );

    await expect(controller.getHealth()).resolves.toEqual({
      status: "ready",
      schemaVersion: 1,
      instanceId: "instance-1",
      ownerId: "local-owner-v1",
      runtime: descriptor,
      startedAt: 123,
    });
    expect(checkConnection).toHaveBeenCalledTimes(1);
  });
});
