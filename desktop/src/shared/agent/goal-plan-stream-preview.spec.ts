import {
  parseGoalPlanStreamPreview,
  goalPlanPreviewFromEvents,
} from "./goal-plan-stream-preview";

it("shows module summaries before the complete path and counts partial lesson contracts", () => {
  const source =
    '{"modules":[{"title":"Foundations","summary":"Start here"}],"learningPath":{"entities":[{"title":"Not a lesson"}],"modules":[{"moduleRef":"m_1","units":[{"title":"Read {a}","summary":"A bracket ] inside text"},{"title":"Practise","provides":[';
  expect(parseGoalPlanStreamPreview(source)).toMatchObject({
    modules: [{ title: "Foundations", summary: "Start here" }],
    unitCount: 2,
  });
});

it("does not report title fragments or entity catalog items as lessons", () => {
  const preview = parseGoalPlanStreamPreview(
    '{"learningPath":{"entities":[{"title":"Concept"}],"modules":[{"units":[{"title":"unfin',
  );
  expect(preview.unitCount).toBe(0);
});

it("restores a durable path preview despite later heartbeat messages", () => {
  const result = goalPlanPreviewFromEvents([
    {
      type: "planning_outline",
      payload: {
        field: "Mathematics",
        topicOverview: "Build a line.",
        whatYouWillLearn: ["Plot", "Explain", "Solve"],
        modules: [],
      },
    },
    {
      type: "planning_activity",
      payload: {
        id: "goal_capability_path",
        message: "Two modules, one lesson drafted.",
        capabilityPath: { moduleTitles: ["Plotting", "Solving"], unitCount: 1 },
      },
    },
    {
      type: "planning_activity",
      payload: {
        id: "goal_journey",
        message: "Still checking.",
        elapsedSeconds: 8,
      },
    },
  ]);
  expect(result).toMatchObject({
    message: "Two modules, one lesson drafted.",
    preview: {
      field: "Mathematics",
      unitCount: 1,
      modules: [{ title: "Plotting" }, { title: "Solving" }],
    },
  });
});

it("does not carry the previous plan's counts into a new revision", () => {
  expect(
    goalPlanPreviewFromEvents([
      {
        type: "planning_activity",
        payload: { capabilityPath: { moduleTitles: ["Old"], unitCount: 9 } },
      },
      {
        type: "planning_activity",
        payload: { id: "goal_identity", status: "active", elapsedSeconds: 0 },
      },
      { type: "planning_outline", payload: { field: "New", modules: [] } },
    ])?.preview,
  ).toMatchObject({ field: "New", modules: [], unitCount: 0 });
});
