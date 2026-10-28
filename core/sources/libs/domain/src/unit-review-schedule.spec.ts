import { scheduleUnitReview } from "./unit-review-schedule.js";

describe("scheduleUnitReview", () => {
  const now = new Date("2026-07-16T08:00:00.000Z");

  it("moves a successful unit review later without producing cognitive state", () => {
    const next = scheduleUnitReview(
      { intervalDays: 3, easeFactor: 2.5, nextReviewAt: now },
      4,
      now,
    );
    expect(next).toEqual({
      intervalDays: 6,
      easeFactor: 2.6,
      nextReviewAt: new Date("2026-07-22T08:00:00.000Z"),
    });
    expect(Object.keys(next)).not.toContain("status");
    expect(Object.keys(next)).not.toContain("estimate");
  });

  it("schedules a short retry after a failed review", () => {
    expect(
      scheduleUnitReview(
        { intervalDays: 10, easeFactor: 2.5, nextReviewAt: now },
        1,
        now,
      ),
    ).toEqual({
      intervalDays: 1,
      easeFactor: 2.3,
      nextReviewAt: new Date("2026-07-17T08:00:00.000Z"),
    });
  });
});
