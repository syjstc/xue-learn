import {BadRequestException, Body, Controller, Get, Patch} from "@nestjs/common";
import {z} from "zod";
import {LOCAL_OWNER_ID} from "@xue-learn/core/runtime-contracts";
import {requireGlobalGenerationSettingsPersistence} from "@xue-learn/core/server/generation/global-generation-settings-persistence";
import {getUserSettingsForUser, upsertUserSettingsForUser} from "@xue-learn/core/server/user-settings";
import {invalidateLlmRuntimeConfig} from "@xue-learn/core/server/llm/runtime-config";
import {invalidateImageRuntimeConfig} from "@xue-learn/core/server/images/runtime-config";
import {invalidateSearchRuntimeConfig} from "@xue-learn/core/server/search/runtime-config";
import {invalidateOpenAiRuntimeConfig} from "@xue-learn/core/server/providers/llm/vendors/openai/runtime-config";
import {invalidateMaterialComponentSettingsCache} from "@xue-learn/core/server/llm/material-component-settings";
import {resetAudioProviderCache} from "@xue-learn/core/server/providers/audio";

const text = z.string().max(2_000);
const nullableText = text.nullable().optional();
const nullableFlag = z.boolean().nullable().optional();
const jsonObject = z.string().max(1_000_000).refine(value => {
  try {const parsed = JSON.parse(value); return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);}
  catch {return false;}
}, "Expected a JSON object").optional();
const globalPatch = z.object({
  imageProvider: text.optional(), searchEnabled: z.boolean().optional(), searchProvider: text.optional(),
  chatAudioProvider: text.optional(), openaiBaseUrl: text.optional(), contentVerificationMode: text.optional(),
  contentVerificationProvider: text.optional(), contentVerificationModel: text.optional(),
  disabledMaterialComponentTypes: z.array(text).max(200).optional(),
  updatedByUserId: z.literal(LOCAL_OWNER_ID).nullable().optional(),
}).strict();
const userPatch = z.object({
  llmProvider: nullableText, chatModel: nullableText, embeddingModel: nullableText, embeddingProvider: nullableText,
  imageProvider: nullableText, imageModel: nullableText, imageGenerationEnabled: nullableFlag,
  maxMaterialIllustrations: z.number().int().min(0).max(1_000).nullable().optional(),
  searchEnabled: nullableFlag, searchProvider: nullableText, minimaxThinkingEnabled: nullableFlag,
  ollamaThinkingEnabled: nullableFlag, deepseekThinkingEnabled: nullableFlag, openaiThinkingEnabled: nullableFlag,
  bigmodelThinkingEnabled: nullableFlag, qwenThinkingEnabled: nullableFlag, doubaoThinkingMode: nullableText,
  customThinkingProtocol: nullableText, customChatEndpointsJson: jsonObject,
  teachingPersonaRef: text.optional(), learningViewMode: text.optional(), chatAudioEnabled: z.boolean().optional(),
  personalMemoryEnabled: z.boolean().optional(), theme: text.optional(), uiLocale: text.optional(),
  clientPreferencesJson: jsonObject, localRuntimeSettingsJson: jsonObject,
}).strict();

function parsePatch<T extends object>(schema: z.ZodType<T>, body: unknown): T {
  const result = z.object({patch: schema}).strict().safeParse(body);
  if (!result.success || !result.data.patch || !Object.keys(result.data.patch).length)
    throw new BadRequestException("Invalid generation settings patch");
  return result.data.patch;
}
function invalidate() {
  invalidateLlmRuntimeConfig(LOCAL_OWNER_ID); invalidateImageRuntimeConfig(); invalidateSearchRuntimeConfig();
  invalidateOpenAiRuntimeConfig(); invalidateMaterialComponentSettingsCache(); resetAudioProviderCache(LOCAL_OWNER_ID);
}

/** Authenticated host port for embedded generators. Credentials remain in the
 * Desktop vault; these records contain model selections and preferences only. */
@Controller("api/local/generation-settings")
export class LocalGenerationSettingsController {
  @Get()
  async get() {
    const [global, user] = await Promise.all([
      requireGlobalGenerationSettingsPersistence().get(), getUserSettingsForUser(LOCAL_OWNER_ID),
    ]);
    return {global, user};
  }
  @Patch("global")
  async updateGlobal(@Body() body: unknown) {
    const patch = parsePatch(globalPatch, body);
    const record = await requireGlobalGenerationSettingsPersistence().update({...patch, updatedByUserId: LOCAL_OWNER_ID});
    invalidate();
    return record;
  }
  @Patch("user")
  async updateUser(@Body() body: unknown) {
    const patch = parsePatch(userPatch, body);
    await upsertUserSettingsForUser(LOCAL_OWNER_ID, {create: patch, update: patch});
    invalidate();
    return getUserSettingsForUser(LOCAL_OWNER_ID);
  }
}
