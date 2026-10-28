import { ensurePersonalSyncCapture, getPersonalSyncCaptureContext, runWithPersonalSyncApply, runWithPersonalSyncCapture } from "./capture.js";

it("isolates overlapping application capture scopes without a SQL host", async () => {
  const seen = await Promise.all(["one", "two"].map(commitId => runWithPersonalSyncCapture(async () => {
    await Promise.resolve();
    return ensurePersonalSyncCapture(() => getPersonalSyncCaptureContext());
  }, commitId)));
  expect(seen).toEqual([{ commitId: "one", mode: "capture" }, { commitId: "two", mode: "capture" }]);
  expect(getPersonalSyncCaptureContext()).toBeUndefined();
});

it("retains remote-apply suppression across generic callbacks", () => {
  runWithPersonalSyncApply(() => {
    const original = getPersonalSyncCaptureContext();
    expect(ensurePersonalSyncCapture(() => getPersonalSyncCaptureContext())).toBe(original);
    expect(original?.mode).toBe("apply");
  });
});
