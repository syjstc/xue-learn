import { isRegistrationEnabled as checkRegistrationEnabled } from "../../libs/domain/src/index.js";
import { isDev } from "./dev.js";

export {
  FEATURE_ADVANCED_HTML_DIAGRAMS,
  FEATURE_CHAT_AUDIO,
  FEATURE_COURSE_PATTERN,
  FEATURE_FEYNMAN,
  FEATURE_GOAL_CREATION,
  FEATURE_IMAGE_GENERATION,
  FEATURE_KACOM_DETACH,
  FEATURE_MICRO_EXPAND,
  FEATURE_OVERVIEW_COURSE,
  FEATURE_REFERENCE_SOURCES,
  FEATURE_REGISTRATION,
  FEATURE_SUBDIVIDE_UNIT,
  isAdvancedHtmlDiagramsEnabled,
  isChatAudioFeatureEnabled,
  isDesktopPythonPlaygroundEnabled,
  isImageGenerationFeatureEnabled,
  isRegistrationEnabled,
  postQuizNextStep,
  type PostQuizStep,
} from "../../libs/domain/src/index.js";

export function registrationEnabled(): boolean {
  return checkRegistrationEnabled(isDev());
}
