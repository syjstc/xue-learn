import {assertReadingSvgRenderable} from "./figure-svg.js";

it("accepts compact and vertically stacked reading diagrams", () => {
  for (const viewBox of ["0 0 720 540", "0 0 720 900", "0,0,800,1000", "-10 -20 640 200"])
    expect(assertReadingSvgRenderable(`<svg viewBox="${viewBox}"><text font-size="26">关系</text></svg>`))
      .toContain(viewBox);
});

it.each(["0 0 1600 900", "0 0 720 2000", "0 0 0 900", "0 0 -720 900", "0 0 NaN 540", "0 0 720", "0 0 720 540 1"])(
  "rejects an unsuitable generated canvas (%s) so it can be repaired", viewBox => {
    expect(() => assertReadingSvgRenderable(`<svg viewBox="${viewBox}"></svg>`)).toThrow("viewBox");
  },
);

it("requires an explicit viewBox and retains the existing SVG safety checks", () => {
  expect(() => assertReadingSvgRenderable('<svg width="720" height="540"></svg>')).toThrow("viewBox");
  expect(() => assertReadingSvgRenderable('<svg viewBox="0 0 720 540"><script>alert(1)</script></svg>')).toThrow("executable");
});
