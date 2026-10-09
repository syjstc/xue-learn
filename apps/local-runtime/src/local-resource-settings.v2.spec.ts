import { BadRequestException } from "@nestjs/common";
import { LocalResourceSettingsController } from "./local-resource-settings.controller.ts";

const readLocalRuntimeSettings = jest.fn();
const saveLocalRuntimeSettings = jest.fn();

jest.mock("@xue-learn/core/source/libs/server/src/rag/local-runtime-settings.ts", () => ({
  LOCAL_RAG_MAX_CHUNKS_MIN: 1,
  LOCAL_RAG_MAX_CHUNKS_MAX: 10_000,
  localRuntimeSettingsSchema: jest
    .requireActual("zod")
    .z.object({
      ragMaxChunksPerUpload: jest
        .requireActual("zod")
        .z.number()
        .int()
        .min(1)
        .max(10_000)
        .optional(),
    })
    .strict(),
  readLocalRuntimeSettings: (...args: unknown[]) =>
    readLocalRuntimeSettings(...args),
  saveLocalRuntimeSettings: (...args: unknown[]) =>
    saveLocalRuntimeSettings(...args),
}));

describe("desktop-local resource settings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readLocalRuntimeSettings.mockResolvedValue({
      ragMaxChunksPerUpload: 1_200,
    });
    saveLocalRuntimeSettings.mockResolvedValue(undefined);
  });

  it("returns the persisted upload chunk ceiling", async () => {
    await expect(
      new LocalResourceSettingsController().get("local-owner-v1"),
    ).resolves.toEqual({
      ragMaxChunksPerUpload: 1_200,
      limits: { ragMaxChunksPerUpload: { min: 1, max: 10_000 } },
    });
  });

  it("persists a valid ceiling", async () => {
    const controller = new LocalResourceSettingsController();
    await controller.patch("local-owner-v1", {
      ragMaxChunksPerUpload: 1_500,
    });

    expect(saveLocalRuntimeSettings).toHaveBeenCalledWith("local-owner-v1", {
      ragMaxChunksPerUpload: 1_500,
    });
  });

  it("rejects values outside the safe range", async () => {
    await expect(
      new LocalResourceSettingsController().patch("local-owner-v1", {
        ragMaxChunksPerUpload: 10_001,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
