/// <reference types="jest" />

import { buildGoalPathSearchQuery, gatherGoalPathContext } from "./goal-path-context.js";
import { readUploadedPlanningSources } from "../rag/planning-sources.js";
import { retrieveUploadedForUnitWithSources } from "../rag/retrieve.js";

jest.mock("../rag/planning-sources.js", () => ({ readUploadedPlanningSources: jest.fn() }));
jest.mock("../rag/retrieve.js", () => ({
  goalHasRagDocuments: jest.fn(async () => true),
  retrieveForUnitWithSources: jest.fn(),
  retrieveUploadedForUnitWithSources: jest.fn(async () => ({ context: "", sources: [] })),
}));

describe("docs-first source gathering", () => {
  it("uses a complete source read for planning and never top-k fallback on read failure", async () => {
    jest.mocked(readUploadedPlanningSources).mockResolvedValueOnce({
      context: "all source sections", sources: [{ kind: "upload", title: "syllabus" }], mode: "rag",
    });
    const input = { goalId: "g", title: "Physics", uploadedDocumentsOnly: true, searchPurpose: "map" as const };
    await expect(gatherGoalPathContext(input)).resolves.toEqual({
      context: "all source sections", pathSource: "rag", sourceCount: 1,
    });
    jest.mocked(readUploadedPlanningSources).mockRejectedValueOnce(new Error("incomplete"));
    await expect(gatherGoalPathContext(input)).rejects.toThrow("incomplete");
    expect(retrieveUploadedForUnitWithSources).not.toHaveBeenCalled();
  });

  it("keeps bounded retrieval for an ordinary summary", async () => {
    await gatherGoalPathContext({ goalId: "g", title: "Physics", uploadedDocumentsOnly: true, searchPurpose: "summary" });
    expect(retrieveUploadedForUnitWithSources).toHaveBeenCalledWith("g", "Physics", expect.any(String), 8);
  });
});

describe("buildGoalPathSearchQuery", () => {
  it("keeps the confirmed subject and learner priorities omitted by the display title", () => {
    const query = buildGoalPathSearchQuery({
      title: "日常会话交流（生活、社交场景）",
      generationOptions: `[User-confirmed goal contract — authoritative]
Original learning goal: 英文口语快速突破，可以无障碍交流
Starting level: basic
你目前的英语口语基础大概是哪种程度？: 能说简单句子，但交流卡壳、反应慢
在「无障碍交流」里，你最想优先突破哪些方面？: 日常词汇和地道表达积累、听懂老外快速口语的能力、对话反应速度和临场组织

Learner profile (known context; do not re-ask):
Preferred nickname: 上仙

Global learner cognitive memory:
- unrelated private learning history`,
    });

    expect(query).toContain("日常会话交流（生活、社交场景）");
    expect(query).toContain("英文口语快速突破，可以无障碍交流");
    expect(query).toContain("听懂老外快速口语的能力");
    expect(query).not.toContain("Starting level");
    expect(query).not.toContain("上仙");
    expect(query).not.toContain("private learning history");
  });

  it("uses the title and adjustment when no confirmed contract exists", () => {
    expect(
      buildGoalPathSearchQuery({
        title: "Transformer 基础",
        generationOptions: "Use project-based teaching.",
        extraQuery: "增加 Python 代码阅读",
      }),
    ).toBe("Transformer 基础 增加 Python 代码阅读");
  });
});
