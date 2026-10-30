import { loadGoalCreationEventPages } from "./goal-creation-event-pages";

it("restores more than one page and then requests only new events", async () => {
  const events = Array.from({ length: 502 }, (_, index) => ({
    sequence: index + 1,
    type: "planning_activity",
    payload: {},
    createdAt: "",
  }));
  const fetchPage = jest.fn(async (after: number) => {
    const page = events.filter((event) => event.sequence > after).slice(0, 250);
    return { events: page, cursor: page.at(-1)?.sequence ?? after };
  });
  const restored = await loadGoalCreationEventPages(fetchPage);
  expect(restored.events).toHaveLength(502);
  expect(fetchPage.mock.calls.map(([after]) => after)).toEqual([0, 250, 500]);
  events.push({ sequence: 503, type: "tool_ui", payload: {}, createdAt: "" });
  expect(
    (await loadGoalCreationEventPages(fetchPage, restored)).events,
  ).toHaveLength(503);
  expect(fetchPage.mock.calls.at(-1)).toEqual([502]);
});
