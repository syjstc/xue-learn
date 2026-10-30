import type { GoalCreationSessionEventsResponse } from "./goal-creation-session";

/** Continue past the API's 250-event page, including after a long plan revision. */
export async function loadGoalCreationEventPages(
  fetchPage: (after: number) => Promise<GoalCreationSessionEventsResponse>,
  previous?: GoalCreationSessionEventsResponse,
): Promise<GoalCreationSessionEventsResponse> {
  const events = [...(previous?.events ?? [])];
  let cursor = previous?.cursor ?? 0;
  for (;;) {
    const page = await fetchPage(cursor);
    if (page.cursor <= cursor || page.events.length === 0)
      return { events, cursor };
    events.push(...page.events.filter((event) => event.sequence > cursor));
    cursor = page.cursor;
    if (page.events.length < 250) return { events, cursor };
  }
}
