import { compactOversizedLocalApiRequestLog } from "./local-api-log-compaction.ts";

describe("local API log compaction", () => {
  it("rebuilds only runaway device-local telemetry", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce([{ oversized: 1 }])
      .mockResolvedValue([]);
    const em = { getConnection: () => ({ execute }) } as never;

    await expect(compactOversizedLocalApiRequestLog(em)).resolves.toBe(true);
    expect(execute.mock.calls.map(([sql]) => sql)).toEqual(
      expect.arrayContaining([
        `DROP TABLE "ApiRequestLog"`,
        "PRAGMA wal_checkpoint(TRUNCATE)",
        "VACUUM",
      ]),
    );
  });

  it("leaves a normally sized log untouched", async () => {
    const execute = jest.fn().mockResolvedValue([]);
    const em = { getConnection: () => ({ execute }) } as never;

    await expect(compactOversizedLocalApiRequestLog(em)).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
