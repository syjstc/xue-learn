import type { EntityManager } from "@mikro-orm/core";
import {
  configureLocalPersonalSyncRuntime,
  disableLocalPersonalSyncRuntime,
  getLocalPersonalSyncRuntime,
} from "./runtime.ts";

describe("local personal sync runtime", () => {
  it("can disable sync without replacing the database runtime", () => {
    const em = {} as EntityManager;
    configureLocalPersonalSyncRuntime({
      workspaceId: "2f551cc2-c374-4bc0-9701-b24d3890d8ab",
      syncEnabled: true,
      workspaceKey: Buffer.alloc(32, 1),
      em,
    });

    disableLocalPersonalSyncRuntime();

    expect(getLocalPersonalSyncRuntime()).toEqual({
      workspaceId: "2f551cc2-c374-4bc0-9701-b24d3890d8ab",
      syncEnabled: false,
      workspaceKey: null,
      em,
    });
  });
});
