import {
  compileMaterialMusic,
  musicFrame,
  musicPerformance,
  type MaterialMusic,
} from "./material-music.js";
import fixture from "../../../scripts/fixtures/music-integration/topic.json";
const source = () => structuredClone(fixture.display) as MaterialMusic;
test("label-only comparisons cannot pretend to reverse the same score", () => {
  const score = source();
  score.steps[0]!.compare = { label: "反向", bars: [1, 1], parts: ["melody"] };
  expect(() => compileMaterialMusic(score)).toThrow("same sound");
});
test("frames are reversible and a rest has no active keys", () => {
  const plan = compileMaterialMusic(source()),
    selection = plan.source.steps[0]!;
  const first = musicFrame(plan, selection, 0.2);
  musicFrame(plan, selection, 2.5);
  expect(musicFrame(plan, selection, 0.2)).toEqual(first);
  expect(musicFrame(plan, selection, 3.2).notes).toEqual([]);
  expect(musicFrame(plan, selection, 4.2).notes).toEqual([]);
  expect(musicPerformance(plan, selection, 0.5).duration).toBeCloseTo(16 / 3);
});
