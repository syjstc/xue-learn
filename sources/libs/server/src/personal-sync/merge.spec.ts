import {
  mergeCompletedIds,
  mergeCompletionStatus,
  mergeGrowOnlyCounters,
  mergeVersionedNote,
} from "./merge.js";

describe("personal sync merge reducers", () => {
  const deviceA = "2f551cc2-c374-4bc0-9701-b24d3890d8ab";
  const deviceB = "5d119cc9-9bd2-474a-b74e-2250847f57ea";

  it("preserves monotonic progress and per-device time", () => {
    expect(mergeCompletedIds(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(mergeCompletionStatus("completed", "in_progress")).toBe("completed");
    expect(mergeGrowOnlyCounters({ [deviceA]: 20 }, { [deviceA]: 10, [deviceB]: 30 })).toEqual({
      [deviceA]: 20,
      [deviceB]: 30,
    });
  });

  it("retains concurrent note revisions", () => {
    const result = mergeVersionedNote(
      {
        revisionId: "left",
        baseRevisionId: "base",
        clock: { wallTimeMs: 10, counter: 0, deviceId: deviceA },
        value: "left",
      },
      {
        revisionId: "right",
        baseRevisionId: "base",
        clock: { wallTimeMs: 11, counter: 0, deviceId: deviceB },
        value: "right",
      },
    );
    expect(result).toEqual({
      status: "conflict",
      preferred: expect.objectContaining({ revisionId: "right" }),
      alternate: expect.objectContaining({ revisionId: "left" }),
    });
  });
});
