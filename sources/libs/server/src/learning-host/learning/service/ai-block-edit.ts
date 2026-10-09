import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { tBackend } from "../../../../../common/src/index.js";
import type {
  MaterialRegenerationRepository,
  UnitDeliveryReadRepository,
} from "../../../../../domain/src/index.js";
import { runWithUserId } from "../../../user-context.js";
import { runGenerationContextScope } from "../../../generation/kernel.js";
import {
  editCourseMaterialBlockWithAi,
  isAiEditableBlockType,
} from "../../../llm/course-material-block-edit.js";
import { resolveGoalContentLanguage } from "../../../llm/content-language.js";
import {
  persistLegacyBlockDeletion,
  persistLegacyBlockReplacement,
  persistSectionBlockDeletion,
  persistSectionBlockReplacement,
  resolveRegenerationMaterialTarget,
} from "./regenerate.js";

const MAX_BLOCK_EDIT_INSTRUCTION_LENGTH = 2_000;

/**
 * Per-block AI edits are a desktop development tool for inspecting and
 * tuning authored lessons; packaged desktop and hosted runtimes reject them.
 */
function isDesktopDevAiBlockEditEnabled(): boolean {
  return (
    process.env.XUELEARN_DESKTOP_LOCAL === "1" &&
    process.env.XUELEARN_DESKTOP_DEV === "1"
  );
}

export async function editComponentWithAi(
  repository: MaterialRegenerationRepository,
  unitRead: UnitDeliveryReadRepository,
  userId: string,
  unitId: string,
  blockIndex: number,
  instruction: string,
  onPartial?: (component: unknown) => void | Promise<void>,
) {
  if (!isDesktopDevAiBlockEditEnabled()) {
    throw new ForbiddenException(
      tBackend("error.learning.aiBlockEditUnavailable"),
    );
  }
  const instructionText = instruction.trim();
  if (!instructionText) {
    throw new BadRequestException(
      tBackend("error.learning.aiBlockEditInstructionRequired"),
    );
  }

  const [unit, content] = await Promise.all([
    unitRead.findPage({ userId, unitId }),
    unitRead.findContent({ userId, unitId }),
  ]);
  if (!unit || !content)
    throw new NotFoundException(tBackend("error.goal.unitNotFound"));

  const target = await resolveRegenerationMaterialTarget(
    repository,
    userId,
    unitId,
    blockIndex,
  );
  const current = target.material.blocks[target.localBlockIndex];
  if (!current) {
    throw new BadRequestException(tBackend("error.learning.componentMissing"));
  }
  if (!isAiEditableBlockType(current.type)) {
    throw new BadRequestException(
      tBackend("error.learning.aiBlockEditUnsupported"),
    );
  }

  const contentLanguage = resolveGoalContentLanguage(
    unit.contentLanguage,
    unit.goalTitle,
  );
  const component = await runGenerationContextScope(
    {
      subject: { userId, goalId: unit.goalId, unitId },
      query: `${unit.title}: ai edit material block`,
    },
    () =>
      runWithUserId(userId, () =>
        editCourseMaterialBlockWithAi({
          unitTitle: target.sectionContext
            ? `${unit.title} · ${target.sectionContext.title}`
            : unit.title,
          language: contentLanguage,
          instruction: instructionText.slice(
            0,
            MAX_BLOCK_EDIT_INSTRUCTION_LENGTH,
          ),
          block: current,
          introduction: target.material.introduction,
          surroundingBlocks: target.material.blocks.filter(
            (_block, index) =>
              Math.abs(index - target.localBlockIndex) <= 2 &&
              index !== target.localBlockIndex,
          ),
          meta: { unitId, blockIndex, aiBlockEdit: true },
          onPartial,
        }),
      ),
  );
  if (!component || component.type !== current.type) {
    throw new BadRequestException(tBackend("error.learning.aiBlockEditFailed"));
  }

  const updated = {
    ...target.material,
    blocks: target.material.blocks.map((block, index) =>
      index === target.localBlockIndex ? component : block,
    ),
  };
  if (target.sectionContext) {
    const saved = await persistSectionBlockReplacement({
      repository,
      userId,
      unitId,
      blockIndex,
      sectionId: target.sectionContext.id,
      expectedSectionRevision: target.sectionContext.contentRevision,
      blocksJson: JSON.stringify(updated.blocks),
      replacement: component,
    });
    if (!saved.applied) {
      throw new HttpException(
        tBackend("error.learning.contentUpdated"),
        HttpStatus.CONFLICT,
      );
    }
    return { component, contentRevision: saved.contentRevision };
  }

  const persisted = await persistLegacyBlockReplacement({
    repository,
    unitRead,
    userId,
    goalId: unit.goalId,
    unitId,
    blockIndex: target.localBlockIndex,
    replacement: component,
    fallbackBlocksJson: JSON.stringify(updated.blocks),
    expectedContentRevision: content.contentRevision,
    graphState: content.graphState,
  });
  if (!persisted.applied) {
    throw new HttpException(
      tBackend("error.learning.contentUpdated"),
      HttpStatus.CONFLICT,
    );
  }
  return { component, contentRevision: persisted.contentRevision };
}

/** Delete one authored/generated block in the desktop development editor. */
export async function deleteComponentBlock(
  repository: MaterialRegenerationRepository,
  unitRead: UnitDeliveryReadRepository,
  userId: string,
  unitId: string,
  blockIndex: number,
) {
  if (!isDesktopDevAiBlockEditEnabled()) {
    throw new ForbiddenException(
      tBackend("error.learning.blockDeleteUnavailable"),
    );
  }

  const [unit, content] = await Promise.all([
    unitRead.findPage({ userId, unitId }),
    unitRead.findContent({ userId, unitId }),
  ]);
  if (!unit || !content) {
    throw new NotFoundException(tBackend("error.goal.unitNotFound"));
  }

  const target = await resolveRegenerationMaterialTarget(
    repository,
    userId,
    unitId,
    blockIndex,
  );
  const current = target.material.blocks[target.localBlockIndex];
  if (!current) {
    throw new BadRequestException(tBackend("error.learning.componentMissing"));
  }
  if (current.type === "check") {
    throw new BadRequestException(
      tBackend("error.learning.blockDeleteAssessmentForbidden"),
    );
  }

  const deletedBlockFingerprint = JSON.stringify(current);
  const updated = {
    ...target.material,
    blocks: target.material.blocks.filter(
      (_, index) => index !== target.localBlockIndex,
    ),
  };
  if (target.sectionContext) {
    const saved = await persistSectionBlockDeletion({
      repository,
      userId,
      unitId,
      blockIndex,
      sectionId: target.sectionContext.id,
      expectedSectionRevision: target.sectionContext.contentRevision,
      blocksJson: JSON.stringify(updated.blocks),
      deletedBlockFingerprint,
    });
    if (!saved.applied) {
      throw new HttpException(
        tBackend("error.learning.contentUpdated"),
        HttpStatus.CONFLICT,
      );
    }
    return { deleted: true, contentRevision: saved.contentRevision };
  }

  const persisted = await persistLegacyBlockDeletion({
    repository,
    unitRead,
    userId,
    goalId: unit.goalId,
    unitId,
    blockIndex: target.localBlockIndex,
    deletedBlockFingerprint,
    fallbackBlocksJson: JSON.stringify(updated.blocks),
    expectedContentRevision: content.contentRevision,
    graphState: content.graphState,
  });
  if (!persisted.applied) {
    throw new HttpException(
      tBackend("error.learning.contentUpdated"),
      HttpStatus.CONFLICT,
    );
  }
  return { deleted: true, contentRevision: persisted.contentRevision };
}
