import { personalSyncTimestampIso } from "./timestamp.ts";

describe("personal sync timestamps", () => {
  it("treats a zone-less SQLite CURRENT_TIMESTAMP as UTC", () => {
    expect(personalSyncTimestampIso("2026-08-14 05:22:56")).toBe(
      "2026-08-14T05:22:56.000Z",
    );
  });

  it("preserves timestamps that already include an offset", () => {
    expect(personalSyncTimestampIso("2026-08-14T13:22:56+08:00")).toBe(
      "2026-08-14T05:22:56.000Z",
    );
  });
});
