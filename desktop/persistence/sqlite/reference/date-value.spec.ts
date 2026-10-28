import {
  nullableReferenceDateValue,
  referenceDateValue,
  safeReferenceDateValue,
  sqlTimestampParameter,
} from "./date-value.ts";

describe("referenceDateValue", () => {
  it.each([
    [1_786_406_792_091, "2026-08-11T00:06:32.091Z"],
    ["1786406792091", "2026-08-11T00:06:32.091Z"],
    ["2026-08-11T00:06:32.091Z", "2026-08-11T00:06:32.091Z"],
    ["2026-08-11 00:06:32.091", "2026-08-11T00:06:32.091Z"],
    ["2026-08-11T00:06:32.091", "2026-08-11T00:06:32.091Z"],
  ])("normalizes %p", (input, expected) => {
    expect(referenceDateValue(input).toISOString()).toBe(expected);
  });

  it("preserves Date instances and nullability", () => {
    const input = new Date("2026-08-11T00:06:32.091Z");
    expect(referenceDateValue(input)).toBe(input);
    expect(nullableReferenceDateValue(null)).toBeNull();
  });

  it("fails explicitly for invalid persisted values", () => {
    expect(() => referenceDateValue("not-a-date", "updatedAt")).toThrow(
      "Invalid updatedAt",
    );
  });

  it("supports permissive legacy reads without returning Invalid Date", () => {
    expect(safeReferenceDateValue(1_786_406_792_091)?.toISOString()).toBe(
      "2026-08-11T00:06:32.091Z",
    );
    expect(safeReferenceDateValue("not-a-date")).toBeNull();
  });

  it("binds stable ISO text for SQLite", () => {
    const input = new Date("2026-08-25T06:45:00.000Z");
    expect(sqlTimestampParameter(false, input)).toBe(
      "2026-08-25T06:45:00.000Z",
    );
  });
});
