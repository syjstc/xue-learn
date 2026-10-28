import { normalizeLlmLogDate } from "./llm-log-query.repository.ts";

describe("LLM log SQLite date normalization", () => {
  it("accepts millisecond timestamps returned by SQLite", () => {
    expect(normalizeLlmLogDate(1_786_369_902_656).toISOString()).toBe(
      "2026-08-10T13:51:42.656Z",
    );
    expect(normalizeLlmLogDate("1786369902656").toISOString()).toBe(
      "2026-08-10T13:51:42.656Z",
    );
  });

  it("preserves ISO timestamps used by PostgreSQL-compatible reads", () => {
    expect(normalizeLlmLogDate("2026-08-10T13:51:42.656Z").toISOString()).toBe(
      "2026-08-10T13:51:42.656Z",
    );
  });
});
