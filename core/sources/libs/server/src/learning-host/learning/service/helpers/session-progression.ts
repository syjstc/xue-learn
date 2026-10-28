import { BadRequestException } from "@nestjs/common";
import { tBackend } from "../../../../../../common/src/index.js";
import { UnitSessionProgressionError } from "../../../../unit-session/application.js";

/** Keeps the portable command contract free of HTTP and localization details. */
export function hostedSessionProgressionException(error: unknown) {
  if (!(error instanceof UnitSessionProgressionError)) return null;
  switch (error.code) {
    case "section_id_required":
      return new BadRequestException(
        tBackend("error.learning.sectionIdRequired"),
      );
    case "unit_learning_required":
      return new BadRequestException(
        tBackend("error.learning.completeUnitFirst"),
      );
    case "invalid_step":
      return new BadRequestException(tBackend("error.learning.invalidStep"));
    case "feynman_unavailable":
      return new BadRequestException(
        tBackend("error.learning.feynmanUnavailable"),
      );
    case "section_quiz_invalid":
      return new BadRequestException(
        tBackend("error.learning.sectionQuizInvalid"),
      );
    case "section_quiz_answers_only":
      return new BadRequestException(
        tBackend("error.learning.sectionQuizAnswersOnly"),
      );
    case "all_answers_required":
      return new BadRequestException(
        tBackend("error.learning.allAnswersRequired"),
      );
    case "invalid_answer_format":
      return new BadRequestException(
        tBackend("error.learning.invalidAnswerFormat"),
      );
  }
}
