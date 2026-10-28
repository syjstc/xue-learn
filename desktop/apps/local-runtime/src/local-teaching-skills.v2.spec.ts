import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { LocalTeachingSkillsController } from "./local-teaching-skills.controller.ts";

describe("desktop-local teaching skills", () => {
  it("uses a local route without inheriting the hosted admin guard", () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, LocalTeachingSkillsController),
    ).toBe("api/local/teaching-skills");
    expect(
      Reflect.getMetadata(GUARDS_METADATA, LocalTeachingSkillsController) ?? [],
    ).toEqual([]);
  });
});
