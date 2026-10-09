import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { tBackend } from "../../../../common/src/index.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";
import {
  indexTeachingSkillVersion,
  resolveTeachingSkillForGoal,
  setTeachingSkillForGoal,
  validateTeachingSkillPackage,
} from "../../teaching-skills/index.js";

function asFiles(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(
      tBackend("error.teachingSkill.filesObjectInvalid"),
    );
  }
  const files = Object.fromEntries(
    Object.entries(value).map(([path, content]) => {
      if (typeof content !== "string") {
        throw new BadRequestException(
          tBackend("error.teachingSkill.fileTextRequired", { path }),
        );
      }
      return [path, content];
    }),
  );
  try {
    validateTeachingSkillPackage(files);
  } catch (error) {
    throw new BadRequestException(
      tBackend("error.teachingSkill.invalidPackage"),
    );
  }
  return files;
}

@Injectable()
export class TeachingSkillsService {
  constructor(private readonly persistence: LearningSpaceOrmProvider) {}

  async list(
    query?: string,
    status?: string,
    category?: string,
    path?: string,
    tag?: string,
  ) {
    return this.persistence.teachingSkillRuntime.listAdmin({
      query,
      status,
      category,
      path,
      tag,
    });
  }

  async get(id: string) {
    const skill = await this.persistence.teachingSkillRuntime.findAdmin(id);
    if (!skill)
      throw new NotFoundException(tBackend("error.teachingSkill.notFound"));
    return skill;
  }

  async saveDraft(adminUserId: string, body: unknown) {
    const files = asFiles((body as { files?: unknown } | null)?.files);
    try {
      const result = await this.persistence.teachingSkillRuntime.saveDraft({
        files,
        adminUserId,
      });
      return this.get(result.skillId);
    } catch (error) {
      throw new BadRequestException(tBackend("error.teachingSkill.saveFailed"));
    }
  }

  async publish(id: string) {
    try {
      await this.persistence.teachingSkillRuntime.publishDraft(id);
      return this.get(id);
    } catch (error) {
      throw new BadRequestException(
        tBackend("error.teachingSkill.publishFailed"),
      );
    }
  }

  async archive(id: string) {
    const skill = await this.persistence.teachingSkillRuntime.findAdmin(id);
    if (!skill)
      throw new NotFoundException(tBackend("error.teachingSkill.notFound"));
    if (skill.slug === "general-teaching") {
      throw new BadRequestException(
        tBackend("error.teachingSkill.builtinArchiveForbidden"),
      );
    }
    await this.persistence.teachingSkillRuntime.archive(id);
    return this.get(id);
  }

  async reindex(id: string) {
    const versionId =
      await this.persistence.teachingSkillRuntime.findPublishedVersionId(id);
    if (!versionId) {
      throw new NotFoundException(
        tBackend("error.teachingSkill.publishedNotFound"),
      );
    }
    await indexTeachingSkillVersion(versionId);
    return this.get(id);
  }

  async exportFiles(id: string) {
    const versionId =
      await this.persistence.teachingSkillRuntime.findPublishedVersionId(id);
    if (!versionId) {
      throw new NotFoundException(
        tBackend("error.teachingSkill.publishedNotFound"),
      );
    }
    return this.persistence.teachingSkillRuntime.exportFiles(versionId);
  }

  async clone(adminUserId: string, id: string, body: unknown) {
    const slug = (body as { slug?: unknown } | null)?.slug;
    if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new BadRequestException(
        tBackend("error.teachingSkill.slugRequired"),
      );
    }
    const files = await this.exportFiles(id);
    const adapter = JSON.parse(files["xuelearn.json"]!) as Record<
      string,
      unknown
    >;
    adapter.slug = slug;
    files["xuelearn.json"] = JSON.stringify(adapter, null, 2);
    const result = await this.persistence.teachingSkillRuntime.saveDraft({
      files,
      adminUserId,
      source: "admin",
    });
    return this.get(result.skillId);
  }

  async preview(body: unknown) {
    const goalId = (body as { goalId?: unknown } | null)?.goalId;
    if (typeof goalId !== "string") {
      throw new BadRequestException(
        tBackend("error.teachingSkill.goalIdRequired"),
      );
    }
    const goal = await this.persistence.teachingSkillRuntime.findGoal(goalId);
    if (!goal)
      throw new NotFoundException(tBackend("error.teachingSkill.goalNotFound"));
    return resolveTeachingSkillForGoal({
      goalId,
      title: goal.title,
      level: goal.level,
      generationOptions:
        typeof goal.generationOptions === "string"
          ? goal.generationOptions
          : undefined,
      force: true,
      persist: false,
    });
  }

  async getGoalBinding(goalId: string) {
    return this.persistence.teachingSkillRuntime.findPrimaryBinding(goalId);
  }

  async setGoalBinding(goalId: string, body: unknown) {
    const record = body as {
      mode?: unknown;
      skillId?: unknown;
      adminLocked?: unknown;
    } | null;
    if (record?.mode === "automatic") {
      const goal = await this.persistence.teachingSkillRuntime.findGoal(goalId);
      if (!goal) {
        throw new NotFoundException(
          tBackend("error.teachingSkill.goalNotFound"),
        );
      }
      return resolveTeachingSkillForGoal({
        goalId,
        title: goal.title,
        level: goal.level,
        generationOptions:
          typeof goal.generationOptions === "string"
            ? goal.generationOptions
            : undefined,
        force: true,
      });
    }
    if (typeof record?.skillId !== "string") {
      throw new BadRequestException(
        tBackend("error.teachingSkill.skillIdRequired"),
      );
    }
    return setTeachingSkillForGoal({
      goalId,
      skillId: record.skillId,
      adminLocked: record.adminLocked !== false,
    });
  }
}
