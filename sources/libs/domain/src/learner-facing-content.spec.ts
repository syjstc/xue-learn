import { learnerFacingContentIssues, learnerFacingTextIssue } from "./learner-facing-content.js";

const reportedText = "外力功记账和配置参照的失效条件，已有hooke_limits中的模型边界直接引用，不重教定义。";

describe("learner-facing course content", () => {
  it.each([
    reportedText,
    "已有`hooke_limits`中的模型边界可以直接引用。",
    "Use the boundary already taught in hooke_limits.",
    "Do not reteach the definition.",
    "不重教定义，直接应用。",
    "参见 lt_1:c2。",
    "templateId 和 targetIds 必须保持一致。",
    "调用 commit_topic_material 提交这段内容。",
  ])("rejects internal references and authoring notes: %s", text => {
    expect(learnerFacingTextIssue(text)).toContain("resubmit the complete corrected content");
  });

  it("uses the bound IDs without prohibiting arbitrary programming names", () => {
    expect(learnerFacingTextIssue("沿用 hooke_limits 的结论。", { internalIds: ["hooke_limits"] })).toBeDefined();
    expect(learnerFacingTextIssue("模型边界来自 `elastic_bounds`。", { internalIds: ["elastic_bounds"] })).toBeDefined();
    expect(learnerFacingTextIssue("函数 fetch_data 返回 user_id 对应的记录。")).toBeUndefined();
    expect(learnerFacingTextIssue("Refer to user_id when joining the records.")).toBeUndefined();
    expect(learnerFacingTextIssue("参考 create_agent 的定义理解函数参数。")).toBeUndefined();
    expect(learnerFacingTextIssue("这一段检查边界条件。", { internalIds: ["boundary", "x"] })).toBeUndefined();
    expect(learnerFacingTextIssue("请求的 requestId 对应一条日志记录。")).toBeUndefined();
  });

  it("reports visible labels, card copy and narration with their exact paths", () => {
    expect(learnerFacingContentIssues({ id: "object_1", parentId: "object_1",
      stages: [{ id: "stage_1", tracks: [{ targetId: "object_1" }] }], title: "观察相同对象" })).toEqual([]);
    const value = {
      topicId: "loss_check",
      display: { type: "stage", id: "board", figures: [
        { type: "callout", id: "boundary", title: "hooke_limits", body: reportedText },
      ] },
      cues: [{ text: "已有 hooke_limits 的模型边界。", targetIds: ["boundary"] }],
    };
    const before = JSON.stringify(value);
    expect(learnerFacingContentIssues(value, { internalIds: ["hooke_limits"] }).map(issue => issue.path))
      .toEqual([["display", "figures", 0, "title"], ["display", "figures", 0, "body"], ["cues", 0, "text"]]);
    expect(JSON.stringify(value)).toBe(before);
  });

  it("preserves code parts, matching source, math and renderer metadata", () => {
    const value = {
      topicId: "hooke_limits",
      display: { type: "code", id: "board", language: "python",
        parts: [{ id: "hooke_limits", text: "def hooke_limits(user_id):\n    return user_id\n" }],
        regions: [{ id: "region_1", match: "return user_id" }],
      },
      cues: [{ text: "函数 hooke_limits 返回 user_id。", targetIds: ["hooke_limits"] }],
    };
    expect(learnerFacingContentIssues(value, { internalIds: ["hooke_limits"] })).toEqual([]);
    expect(learnerFacingTextIssue("用 $U_{elastic_bounds}$ 表示势能。", { internalIds: ["elastic_bounds"] })).toBeUndefined();
    expect(learnerFacingTextIssue("示例程序：\n```python\nhooke_limits = 1\n```", { internalIds: ["hooke_limits"] })).toBeUndefined();
    expect(learnerFacingContentIssues({ component: { type: "code.v1", props: { language: "python",
      sections: [{ id: "hooke_limits", title: "读取配置", code: "hooke_limits = {'templateId': 'display.v1'}" }],
    } }, beats: [{ text: "变量 hooke_limits 保存配置。", targetIds: ["hooke_limits"] }] })).toEqual([]);
  });

  it("checks prose text boards and image labels while ignoring image-production instructions", () => {
    expect(learnerFacingContentIssues({ id: "topic_1", intent: "用 display.v1 复用已接受的主题，不重教定义。" })).toEqual([]);
    expect(learnerFacingContentIssues({ language: "text", code: reportedText }).map(issue => issue.path)).toEqual([["code"]]);
    expect(learnerFacingContentIssues({ intent: { title: "已有hooke_limits中的边界", composition: "Do not reteach the definition.", parts: [{ id: "part_1", label: "参见 lt_1", description: "Internal image instructions" }] } }).map(issue => issue.path))
      .toEqual([["intent", "title"], ["intent", "parts", 0, "label"]]);
  });

  it.each([
    "沿用前文介绍的胡克定律适用条件，先检查力与形变是否仍成正比。",
    "外部损耗不意味着弹簧储能公式失效；非线性也不等于没有势能。",
    "重新定义坐标原点后，仍应保持能量参考的一致性。",
    "本节教学目标是检查胡克定律的适用范围。",
  ])("accepts substantive teaching: %s", text => {
    expect(learnerFacingTextIssue(text)).toBeUndefined();
  });
});
