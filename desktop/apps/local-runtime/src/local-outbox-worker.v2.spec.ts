import { DesktopLocalModule } from "./desktop-local.module.ts";

describe("desktop-local composition", () => {
  it("mounts the in-process SQLite outbox worker", () => {
    const dynamicModule = DesktopLocalModule.register({
      instanceId: "local-test",
      startedAt: Date.now(),
      descriptor: {
        schemaVersion: 1,
        kind: "desktop-local",
        os: "darwin",
        arch: "arm64",
        appVersion: "test",
        capabilities: [],
      },
    });

    const importedModuleNames = dynamicModule.imports?.map((module) =>
      typeof module === "function" ? module.name : "",
    );
    const controllerNames = dynamicModule.controllers?.map((controller) =>
      typeof controller === "function" ? controller.name : "",
    );

    expect(importedModuleNames).toContain("LocalOutboxModule");
    expect(controllerNames).toContain("LocalUnitImagesController");
  });
});
