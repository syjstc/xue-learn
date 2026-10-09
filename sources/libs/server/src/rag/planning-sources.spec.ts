import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatCompletePlanningSources,
  readUploadedPlanningSources,
  MAX_PLANNING_SOURCE_CHARS,
  MAX_PLANNING_SOURCE_CHUNKS,
} from "./planning-sources.js";
import { requireRagVectors } from "./persistence.js";

jest.mock("./persistence.js", () => ({ requireRagVectors: jest.fn() }));
jest.mock("../llm/request-log.js", () => ({
  beginRagRequestLog: jest.fn(async () => ({ finish: jest.fn() })),
}));

const fixture = JSON.parse(readFileSync(
  join(__dirname, "fixtures/energy-first-planning-sources.json"), "utf8",
)) as { chunks: { content: string; metadata: Record<string, unknown> }[] };

describe("complete uploaded planning sources", () => {
  it("retains every passage of the reported 18-section syllabus in source order", () => {
    const result = formatCompletePlanningSources([...fixture.chunks].reverse());
    let previous = -1;
    for (let i = 0; i < 18; i += 1) {
      const heading = `### E${String(i).padStart(2, "0")}｜`;
      const position = result.context.indexOf(heading);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
    for (const chunk of fixture.chunks) expect(result.context).toContain(chunk.content);
    expect(result.sources).toHaveLength(1);
    expect(result.context).toContain("同一过程选两种系统边界");
    expect(result.context).toContain("不同尺度下，为什么要换用不同的能量模型");
  });

  it("reads all uploaded goal passages even when no embedding index is available", async () => {
    const listSourceChunks = jest.fn(async () => fixture.chunks);
    jest.mocked(requireRagVectors).mockReturnValue({ listSourceChunks } as never);
    const result = await readUploadedPlanningSources("owned-goal");
    expect(listSourceChunks).toHaveBeenCalledWith(
      { scope: "goal", scopeId: "owned-goal", metadata: { source: "upload" } },
      MAX_PLANNING_SOURCE_CHUNKS + 1,
    );
    expect(result.context).toContain("### E17｜");
  });

  it("does not present a storage error or capacity overflow as complete evidence", async () => {
    jest.mocked(requireRagVectors).mockReturnValue({
      listSourceChunks: jest.fn(async () => { throw new Error("read failed"); }),
    } as never);
    await expect(readUploadedPlanningSources("owned-goal")).rejects.toThrow("read failed");
    expect(() => formatCompletePlanningSources([
      { content: "x".repeat(MAX_PLANNING_SOURCE_CHARS + 1), metadata: {} },
    ])).toThrow();
    expect(() => formatCompletePlanningSources(
      Array.from({ length: MAX_PLANNING_SOURCE_CHUNKS + 1 }, () => fixture.chunks[0]!),
    )).toThrow();
  });

  it("deduplicates reindexed passages without dropping distinct source locations", () => {
    const first = fixture.chunks[0]!;
    const result = formatCompletePlanningSources([first, first, fixture.chunks[1]!]);
    expect(result.context).toContain("all 2 indexed passages");
  });
});
