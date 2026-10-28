/** Context ports inherited by every text-generation operation. */
export const BASE_CAPABILITY_ID = "generation-base";
export const BASE_CAPABILITY_VIEW_KEYS = Object.freeze({
  generationPolicy: "system.generation_policy.v1",
  learnerNamePlaceholderPolicy: "system.learner_name_placeholder.v1",
  userFacingResponseLanguage: "system.user_facing_response_language.v1",
  contentMarkup: "system.content_markup.v1",
});
