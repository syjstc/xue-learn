import type { TrackedWorkContext } from "../generation/tracked-sse.js";

export type UnitContentGenPatch = {
  hasSurvey?: boolean;
  hasMaterial?: boolean;
};

export async function sendUnitContentGenEvent(
  ctx: Pick<TrackedWorkContext, "send">,
  unitId: string,
  patch: UnitContentGenPatch,
) {
  await ctx.send({
    type: "unit_content_gen",
    unitId,
    ...patch,
  });
}
