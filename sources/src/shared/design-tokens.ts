import rawDesignTokens from "./design-tokens.json";

export type DesignColorPalette = typeof rawDesignTokens.themes.light;
export type DesignMusicTokens = typeof rawDesignTokens.components.music;
export type DesignCardTokens = typeof rawDesignTokens.components.card;
export type DesignScenarioTheaterTokens =
  typeof rawDesignTokens.components.scenarioTheater;
type DesignTokens = typeof rawDesignTokens;

/**
 * Cross-platform design contract, extracted from the mobile theme.
 * Mobile consumes this object directly; CSS platforms mirror it through
 * semantic custom properties checked by scripts/check-design-tokens.mjs.
 */
export const designTokens: DesignTokens = rawDesignTokens;
