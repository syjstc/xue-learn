/**
 * Product feature flags — single source of truth for client and server.
 * Flip booleans here to enable or hide capabilities.
 * Future: resolve per-user via A/B experiment assignment instead of static constants.
 */

/** Self-service registration on the auth page and /api/auth/register. */
export const FEATURE_REGISTRATION = false;

/** Whether registration is allowed (flag on, or dev environment). */
export function isRegistrationEnabled(isDevEnvironment: boolean): boolean {
  return FEATURE_REGISTRATION || isDevEnvironment;
}

/** Goal creation agent, nav entry, and related global assistant tools. */
export const FEATURE_GOAL_CREATION = true;

/** 参考来源 panel and inline [n] citation badges in learning content. */
export const FEATURE_REFERENCE_SOURCES = false;

/** 课程模式 — goal-level recurring lesson structure and context reuse policy. */
export const FEATURE_COURSE_PATTERN = false;

/** 费曼讲解 step in unit learning and deliberate practice review. */
export const FEATURE_FEYNMAN = false;

/** 课程导览 — independent orientation unit for full goals (not micro). */
export const FEATURE_OVERVIEW_COURSE = true;

/** 拆分单元 — force-subdivide a leaf lesson into a sub-map (hidden by default). */
export const FEATURE_SUBDIVIDE_UNIT = false;

/** 扩展轻课为完整目标 — AI asks questions then converts micro → full (hidden by default). */
export const FEATURE_MICRO_EXPAND = false;

/** Chat-view narration audio (TTS) for every teaching persona. */
export const FEATURE_CHAT_AUDIO = false;

/**
 * Desktop-local users explicitly opt into audio by configuring their own
 * provider credentials, so they do not depend on the hosted rollout switch.
 */
export function isChatAudioFeatureEnabled(
  isDesktopLocalRuntime: boolean,
): boolean {
  return FEATURE_CHAT_AUDIO || isDesktopLocalRuntime;
}

/**
 * Allow interactive HTML playground items inside the optional unit lab.
 * Hosted stays off unless flipped; desktop-local defaults on. In-lesson
 * diagrams always compile to animated_svg — HTML is never a diagram replacement.
 */
export const FEATURE_ADVANCED_HTML_DIAGRAMS = false;

export function isAdvancedHtmlDiagramsEnabled(
  isDesktopLocalRuntime: boolean,
): boolean {
  return FEATURE_ADVANCED_HTML_DIAGRAMS || isDesktopLocalRuntime;
}

/**
 * Desktop-local scratch Python editor (CodeMirror + Pyodide worker).
 * Hosted web/mobile never expose Run; the WASM runtime is not shipped there.
 */
export function isDesktopPythonPlaygroundEnabled(
  isDesktopLocalRuntime: boolean,
): boolean {
  return isDesktopLocalRuntime;
}

/** Course illustration image generation (Settings > 配图). */
export const FEATURE_IMAGE_GENERATION = false;

/**
 * Desktop-local users explicitly opt into illustrations by configuring their
 * own provider credentials, so they do not depend on the hosted rollout switch.
 */
export function isImageGenerationFeatureEnabled(
  isDesktopLocalRuntime: boolean,
): boolean {
  return FEATURE_IMAGE_GENERATION || isDesktopLocalRuntime;
}

/** Encrypted desktop-local workspace sync through the CloudKit Web bridge. */
export const FEATURE_DESKTOP_PERSONAL_SYNC = true;

/**
 * Internal-only escape hatch to run an existing KACOM goal as exploration.
 * The route is additionally restricted to development and administrators;
 * there is deliberately no learner-facing UI.
 */
export const FEATURE_KACOM_DETACH = true;

export function isKacomDetachEnabled(isDevEnvironment: boolean): boolean {
  return FEATURE_KACOM_DETACH && isDevEnvironment;
}
