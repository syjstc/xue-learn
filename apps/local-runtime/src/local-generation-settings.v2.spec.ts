import {BadRequestException} from "@nestjs/common";
import {LocalGenerationSettingsController} from "./local-generation-settings.controller.ts";
import {invalidateLlmRuntimeConfig} from "@xue-learn/core/server/llm/runtime-config";

const global = {imageProvider: "none", updatedByUserId: null, updatedAt: new Date()};
const user = {userId: "local-owner-v1", chatModel: "host-model", updatedAt: new Date()};
const repository = {get: jest.fn(async () => global), update: jest.fn(async patch => ({...global, ...patch}))};
const readUser = jest.fn(async () => user);
const upsertUser = jest.fn(async () => ({updatedAt: new Date()}));
jest.mock("@xue-learn/core/server/generation/global-generation-settings-persistence", () => ({requireGlobalGenerationSettingsPersistence: () => repository}));
jest.mock("@xue-learn/core/server/user-settings", () => ({getUserSettingsForUser: (...args: unknown[]) => readUser(...args as []), upsertUserSettingsForUser: (...args: unknown[]) => upsertUser(...args as [])}));
jest.mock("@xue-learn/core/server/llm/runtime-config", () => ({invalidateLlmRuntimeConfig: jest.fn()}));
jest.mock("@xue-learn/core/server/images/runtime-config", () => ({invalidateImageRuntimeConfig: jest.fn()}));
jest.mock("@xue-learn/core/server/search/runtime-config", () => ({invalidateSearchRuntimeConfig: jest.fn()}));
jest.mock("@xue-learn/core/server/providers/llm/vendors/openai/runtime-config", () => ({invalidateOpenAiRuntimeConfig: jest.fn()}));
jest.mock("@xue-learn/core/server/llm/material-component-settings", () => ({invalidateMaterialComponentSettingsCache: jest.fn()}));
jest.mock("@xue-learn/core/server/providers/audio", () => ({resetAudioProviderCache: jest.fn()}));
beforeEach(() => {jest.clearAllMocks();});

test("embedded generators read the owning Desktop preferences", async () => {
  expect(await new LocalGenerationSettingsController().get()).toEqual({global, user});
  expect(readUser).toHaveBeenCalledWith("local-owner-v1");
});

test("global updates stamp the fixed owner and invalidate generation caches", async () => {
  expect(await new LocalGenerationSettingsController().updateGlobal({patch: {imageProvider: "minimax"}}))
    .toMatchObject({imageProvider: "minimax", updatedByUserId: "local-owner-v1"});
  expect(repository.update).toHaveBeenCalledWith({imageProvider: "minimax", updatedByUserId: "local-owner-v1"});
  expect(invalidateLlmRuntimeConfig).toHaveBeenCalledWith("local-owner-v1");
});

test("user updates return the complete host record for Core persistence adapters", async () => {
  const patch = {chatModel: "selected-model", clientPreferencesJson: '{"codexReasoningEffort":"high"}'};
  expect(await new LocalGenerationSettingsController().updateUser({patch})).toEqual(user);
  expect(upsertUser).toHaveBeenCalledWith("local-owner-v1", {create: patch, update: patch});
});

test.each([
  ["updateUser", {patch: {userId: "another-owner", chatModel: "model"}}],
  ["updateUser", {patch: {clientPreferencesJson: "not-json"}}],
  ["updateUser", {patch: {clientPreferencesJson: "[]"}}],
  ["updateUser", {patch: {apiKey: "never-a-settings-field"}}],
  ["updateGlobal", {patch: {updatedByUserId: "another-owner", imageProvider: "minimax"}}],
  ["updateGlobal", {patch: {searchEnabled: "true"}}],
  ["updateGlobal", {patch: {}}],
  ["updateGlobal", {patch: {imageProvider: "minimax"}, ownerId: "another-owner"}],
] as const)("%s rejects malformed or authority-changing patches", async (method, body) => {
  await expect(new LocalGenerationSettingsController()[method](body)).rejects.toBeInstanceOf(BadRequestException);
  expect(repository.update).not.toHaveBeenCalled(); expect(upsertUser).not.toHaveBeenCalled();
});
