import { parseLsofListenPids } from "./reclaim-loopback-listen.ts";

describe("parseLsofListenPids", () => {
  it("collects unique listener pids", () => {
    expect(parseLsofListenPids("p12\np12\np88\n")).toEqual([12, 88]);
  });
});
