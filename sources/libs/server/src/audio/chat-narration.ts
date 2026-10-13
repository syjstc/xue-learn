import { getRuntimeEnvironment } from "../env.js";
import { createHash } from "node:crypto";
// @ts-nocheck -- unbound compatibility implementation; hosted callers use repositories.
import type { PersistenceClient } from "../persistence/persistence-compat.js";
import type { ChatNarrationRepository } from "../../../domain/src/index.js";
import type { LearningMaterialContent } from "../llm/schemas.js";
import { parseLearningMaterial } from "../graph/unit-session.js";
import { LEARNER_NAME_PLACEHOLDER } from "../learning-systems/learner-name-placeholder-policy.js";
import {
  resolveTeachingPersona,
  type TeachingPersona,
} from "../teaching-personas/index.js";
import { DOUBAO_CHAT_TTS_TIMING_VERSION } from "./doubao-chat-tts.js";
import {
  audioSelectionForProvider,
  getAudioProvider,
  type ChatNarrationCharTiming,
  type TtsProvider,
} from "../providers/audio/index.js";
import { getGlobalChatAudioSettingsSnapshot } from "../providers/audio/global-chat-audio-settings.js";
import { getUserSettingsForUser } from "../user-settings.js";
import { isChatAudioFeatureEnabled } from "../features.js";
import {
  chatAudioObjectKey,
  readChatAudioObject,
  saveChatAudioObject,
} from "./chat-audio-storage.js";
import {
  BUILTIN_CHAT_VOICE_BY_AVATAR,
  type BuiltinChatVoiceProfile,
} from "./minimax-teacher-voices.js";

const BUILD_LEASE_MS = 2 * 60_000;
export const CHAT_NARRATION_BATCH_SIZE = 5;
export const CHAT_NARRATION_PER_ENTRY_CONCURRENCY = 2;

let configuredChatNarrationPersistence: ChatNarrationRepository | undefined;

export function configureChatNarrationPersistence(
  repository: ChatNarrationRepository | undefined,
): void {
  configuredChatNarrationPersistence = repository;
}

export type ChatNarrationEntry = { contentKey: string; text: string };
export type ChatNarrationVoiceProfile = BuiltinChatVoiceProfile & {
  speaker: string;
};

export function chatNarrationVoiceProfile(
  persona: Pick<TeachingPersona, "avatarCode" | "gender">,
): ChatNarrationVoiceProfile {
  const selected =
    BUILTIN_CHAT_VOICE_BY_AVATAR[persona.avatarCode] ??
    (persona.gender === "female"
      ? BUILTIN_CHAT_VOICE_BY_AVATAR.xiaohui_female!
      : BUILTIN_CHAT_VOICE_BY_AVATAR.xiaohui!);
  return { ...selected, speaker: selected.voiceId };
}

export type ChatNarrationAsset = {
  audioId: string;
  contentKey: string;
  textHash: string;
  audioUrl: string;
  mimeType: string;
  durationMs: number;
  audioStartMs: number;
  audioEndMs: number;
  chars: ChatNarrationCharTiming[];
};

export function chatNarrationTextHash(
  text: string,
  timingVersion = DOUBAO_CHAT_TTS_TIMING_VERSION,
): string {
  return createHash("sha256").update(`${timingVersion}\0${text}`).digest("hex");
}

export function chatNarrationEntries(
  material: LearningMaterialContent,
): ChatNarrationEntry[] {
  const narrationText = (text: string) =>
    text.split(LEARNER_NAME_PLACEHOLDER).join("你").trim();
  const entries: ChatNarrationEntry[] = [];
  const introduction = narrationText(material.introduction);
  if (introduction) entries.push({ contentKey: "intro", text: introduction });
  material.blocks.forEach((block, index) => {
    if (block.type === "paragraph" && narrationText(block.text)) {
      entries.push({
        contentKey: `block:${index}`,
        text: narrationText(block.text),
      });
    }
  });
  return entries;
}

function assetFromRow(row: {
  id: string;
  unitId: string;
  contentKey: string;
  textHash: string;
  objectKey: string | null;
  mimeType: string | null;
  durationMs: number | null;
  chars: unknown;
}): ChatNarrationAsset | null {
  if (!row.mimeType || !row.durationMs || !Array.isArray(row.chars))
    return null;
  const chars = row.chars as ChatNarrationCharTiming[];
  const audioStartMs = chars[0]?.startMs ?? 0;
  const audioEndMs =
    chars.length > 0
      ? Math.max(...chars.map((timing) => timing.endMs))
      : row.durationMs;
  const trackAudioId = row.objectKey?.match(/\/([^/]+)\.mp3$/)?.[1] ?? row.id;
  return {
    audioId: trackAudioId,
    contentKey: row.contentKey,
    textHash: row.textHash,
    audioUrl: `/api/units/${row.unitId}/chat-audio/${trackAudioId}`,
    mimeType: row.mimeType,
    durationMs: row.durationMs,
    audioStartMs,
    audioEndMs,
    chars,
  };
}

export async function chatNarrationEnabled(
  userId: string,
  goalId: string,
  client?: PersistenceClient,
): Promise<boolean> {
  // The persisted preference can outlive a deployment-level feature rollout.
  // Keep the server-side synthesis path gated so hiding the client controls
  // cannot leave previously opted-in users generating audio.
  if (!isChatAudioFeatureEnabled(getRuntimeEnvironment().XUELEARN_DESKTOP_LOCAL === "1")) {
    return false;
  }

  const settings = configuredChatNarrationPersistence
    ? await configuredChatNarrationPersistence.readLearnerSettings(userId)
    : await client!.userSettings.findUnique({
        where: { userId },
        select: { chatAudioEnabled: true, learningViewMode: true },
      });
  if (!settings?.chatAudioEnabled || settings.learningViewMode === "reading") {
    return false;
  }
  await resolveTeachingPersona(userId, goalId);
  return true;
}

export async function claimChatNarrationAudioRow(input: {
  userId: string;
  unitId: string;
  sectionId?: string | null;
  contentKey: string;
  textHash: string;
  provider: TtsProvider;
  speaker?: string;
  client?: PersistenceClient;
}) {
  const scopeKey = input.sectionId || "unit";
  const where = {
    userId: input.userId,
    unitId: input.unitId,
    scopeKey,
    contentKey: input.contentKey,
    textHash: input.textHash,
    provider: input.provider.id,
    model: input.provider.model,
    speaker: input.speaker ?? input.provider.speaker,
  };
  if (configuredChatNarrationPersistence) {
    return configuredChatNarrationPersistence.claim({
      ...where,
      sectionId: input.sectionId ?? null,
      timingVersion: input.provider.timingVersion,
      staleBefore: new Date(Date.now() - BUILD_LEASE_MS),
    });
  }
  const client = input.client;
  if (!client) throw new Error("Chat narration persistence is not configured");
  let row = await client.chatNarrationAudio.findFirst({ where });
  if (row?.status === "ready") return { row, claimed: false };
  const staleBefore = new Date(Date.now() - BUILD_LEASE_MS);
  if (
    row?.status === "building" &&
    row.generationStartedAt &&
    row.generationStartedAt > staleBefore
  ) {
    return { row, claimed: false };
  }
  if (row) {
    const claimed = await client.chatNarrationAudio.updateMany({
      where: {
        id: row.id,
        OR: [
          { status: { in: ["failed"] } },
          { generationStartedAt: { lt: staleBefore } },
          { generationStartedAt: null },
        ],
      },
      data: {
        status: "building",
        generationStartedAt: new Date(),
        error: "",
      },
    });
    row = await client.chatNarrationAudio.findUnique({
      where: { id: row.id },
    });
    return { row: row!, claimed: claimed.count === 1 };
  }
  const created = await client.chatNarrationAudio.createMany({
    data: {
      ...where,
      sectionId: input.sectionId ?? null,
      timingVersion: input.provider.timingVersion,
      status: "building",
      generationStartedAt: new Date(),
    },
    skipDuplicates: true,
  });
  row = await client.chatNarrationAudio.findFirstOrThrow({ where });
  return { row, claimed: created.count === 1 };
}

export async function synthesizeChatNarration(input: {
  userId: string;
  unitId: string;
  sectionId?: string | null;
  contentKey: string;
  text: string;
  signal?: AbortSignal;
  client?: PersistenceClient;
}): Promise<ChatNarrationAsset | null> {
  const assets = await synthesizeChatNarrationBatch({
    ...input,
    entries: [{ contentKey: input.contentKey, text: input.text }],
  });
  return assets[0] ?? null;
}

export async function synthesizeChatNarrationBatch(input: {
  userId: string;
  unitId: string;
  sectionId?: string | null;
  entries: ChatNarrationEntry[];
  voiceProfile?: ChatNarrationVoiceProfile;
  signal?: AbortSignal;
  client?: PersistenceClient;
}): Promise<ChatNarrationAsset[]> {
  const client = input.client;
  const markReady = (data: {
    id: string;
    objectKey: string;
    mimeType: string;
    durationMs: number;
    chars: unknown;
  }) =>
    configuredChatNarrationPersistence
      ? configuredChatNarrationPersistence.markReady(data)
      : client!.chatNarrationAudio.update({
          where: { id: data.id },
          data: {
            status: "ready",
            generationStartedAt: null,
            error: "",
            objectKey: data.objectKey,
            mimeType: data.mimeType,
            durationMs: data.durationMs,
            chars: data.chars as never,
          },
        });
  const markFailed = (ids: readonly string[], error: string) =>
    configuredChatNarrationPersistence
      ? configuredChatNarrationPersistence.markFailed({ ids, error })
      : client!.chatNarrationAudio
          .updateMany({
            where: { id: { in: [...ids] }, status: "building" },
            data: { status: "failed", generationStartedAt: null, error },
          })
          .then((result) => result.count);
  const audioSettings = await getGlobalChatAudioSettingsSnapshot();
  const userSettings = await getUserSettingsForUser(input.userId).catch(
    () => null,
  );
  const provider = getAudioProvider(
    audioSelectionForProvider(
      audioSettings.provider,
      userSettings?.clientPreferencesJson,
    ),
  );
  const voiceProfile = input.voiceProfile ?? {
    ...BUILTIN_CHAT_VOICE_BY_AVATAR.xiaohui_female!,
    speaker: BUILTIN_CHAT_VOICE_BY_AVATAR.xiaohui_female!.voiceId,
  };
  const claims = await Promise.all(
    input.entries.map(async (entry) => {
      const textHash = chatNarrationTextHash(
        entry.text,
        provider.timingVersion,
      );
      const claim = await claimChatNarrationAudioRow({
        ...input,
        contentKey: entry.contentKey,
        textHash,
        provider,
        // Qwen-Audio-TTS uses its documented system voice rather than the
        // MiniMax persona voice profile. Keep the cache identity aligned with
        // the actual synthesized voice for single-voice providers.
        speaker:
          provider.id === "qwen" || provider.id === "cartesia"
            ? provider.speaker
            : voiceProfile.speaker,
        client,
      });
      return { entry, textHash, ...claim };
    }),
  );
  const readyAssets = claims.flatMap((claim) => {
    if (claim.claimed || claim.row.status !== "ready") return [];
    const asset = assetFromRow(claim.row);
    return asset ? [asset] : [];
  });
  const claimed = claims.filter((claim) => claim.claimed);
  if (claimed.length === 0) return readyAssets;

  if (provider.chatNarrationBatching === "per_entry") {
    const generated = await mapChatNarrationWithConcurrency(
      claimed,
      CHAT_NARRATION_PER_ENTRY_CONCURRENCY,
      async (claim) => {
        try {
          const speech = await provider.synthesizeChatNarration(
            [claim.entry.text],
            voiceProfile,
            input.signal,
          );
          const segment = speech.segments[0];
          if (!segment || speech.segments.length !== 1) {
            throw new Error(
              "Per-entry narration synthesis returned an invalid segment count",
            );
          }
          const objectKey = chatAudioObjectKey(
            input.userId,
            input.unitId,
            claim.row.id,
          );
          await saveChatAudioObject(objectKey, speech.audio);
          const row = await markReady({
            id: claim.row.id,
            objectKey,
            mimeType: speech.mimeType,
            durationMs: speech.durationMs,
            chars: segment.chars,
          });
          return assetFromRow(row);
        } catch (error) {
          await markFailed(
            [claim.row.id],
            (error instanceof Error ? error.message : String(error)).slice(
              0,
              1_000,
            ),
          );
          return null;
        }
      },
    );
    return [...readyAssets, ...generated.filter((asset) => asset !== null)];
  }

  try {
    const speech = await provider.synthesizeChatNarration(
      claimed.map((claim) => claim.entry.text),
      voiceProfile,
      input.signal,
    );
    const objectKey = chatAudioObjectKey(
      input.userId,
      input.unitId,
      claimed[0]!.row.id,
    );
    await saveChatAudioObject(objectKey, speech.audio);
    const rows = await Promise.all(
      claimed.map((claim, index) => {
        const segment = speech.segments[index]!;
        return markReady({
          id: claim.row.id,
          objectKey,
          mimeType: speech.mimeType,
          durationMs: speech.durationMs,
          chars: segment.chars,
        });
      }),
    );
    return [
      ...readyAssets,
      ...rows.flatMap((row) => {
        const asset = assetFromRow(row);
        return asset ? [asset] : [];
      }),
    ];
  } catch (error) {
    await markFailed(
      claimed.map((claim) => claim.row.id),
      (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
    );
    return readyAssets;
  }
}

export async function mapChatNarrationWithConcurrency<T, R>(
  entries: T[],
  concurrency: number,
  run: (entry: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (entries.length === 0) return [];
  const limit = Math.max(1, Math.min(entries.length, Math.floor(concurrency)));
  const results = Array<R>(entries.length);
  let nextIndex = 0;
  const workers = Array.from({ length: limit }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= entries.length) return;
      results[index] = await run(entries[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createChatNarrationBatchQueue(input: {
  batchSize?: number;
  run: (entries: ChatNarrationEntry[]) => Promise<void>;
}) {
  const batchSize = Math.max(
    1,
    Math.floor(input.batchSize ?? CHAT_NARRATION_BATCH_SIZE),
  );
  let first: Promise<void> | null = null;
  let batches: Promise<void> = Promise.resolve();
  let pending: ChatNarrationEntry[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    const entries = pending.splice(0, batchSize);
    batches = batches
      .then(() => first)
      .then(() => input.run(entries))
      .catch(() => undefined);
  };
  return {
    add(entry: ChatNarrationEntry) {
      if (!first) {
        first = input.run([entry]).catch(() => undefined);
        return;
      }
      pending.push(entry);
      if (pending.length >= batchSize) flush();
    },
    async finish() {
      while (pending.length > 0) flush();
      await Promise.allSettled([first, batches]);
    },
  };
}

export function createProgressiveChatNarrationQueue(input: {
  batchSize?: number;
  run: (entries: ChatNarrationEntry[]) => Promise<void>;
}) {
  const queue = createChatNarrationBatchQueue(input);
  const latest = new Map<string, ChatNarrationEntry>();
  const scheduled = new Set<string>();

  const schedule = (entry: ChatNarrationEntry) => {
    if (scheduled.has(entry.contentKey)) return;
    scheduled.add(entry.contentKey);
    queue.add(entry);
  };

  return {
    observe(material: LearningMaterialContent, completeBlockCount: number = 0) {
      const entries = chatNarrationEntries(material);
      for (const entry of entries) latest.set(entry.contentKey, entry);
      const stableBlockCount = Math.max(
        0,
        Math.min(material.blocks.length, Math.floor(completeBlockCount)),
      );
      for (const entry of entries) {
        if (entry.contentKey === "intro") {
          if (stableBlockCount > 0) schedule(entry);
        }
      }
    },
    async finish() {
      // Streaming JSON can temporarily expose a syntactically complete string
      // while that same paragraph is still growing. Only the introduction is
      // safe to start early (after the first block proves it has closed);
      // paragraph audio must use the final validated material.
      for (const entry of latest.values()) schedule(entry);
      await queue.finish();
    },
  };
}

export async function createChatNarrationCoordinator(input: {
  userId: string;
  goalId: string;
  unitId: string;
  sectionId?: string | null;
  signal?: AbortSignal;
  client?: PersistenceClient;
  batchSize?: number;
  onReady?: (asset: ChatNarrationAsset) => void | Promise<void>;
}) {
  const client = input.client;
  const enabled = await chatNarrationEnabled(
    input.userId,
    input.goalId,
    client,
  );
  const voiceProfile = enabled
    ? chatNarrationVoiceProfile(
        await resolveTeachingPersona(input.userId, input.goalId),
      )
    : undefined;
  const run = async (entries: ChatNarrationEntry[]) => {
    const assets = await synthesizeChatNarrationBatch({
      userId: input.userId,
      unitId: input.unitId,
      sectionId: input.sectionId,
      entries,
      voiceProfile,
      signal: input.signal,
      client,
    });
    for (const asset of assets) await input.onReady?.(asset);
  };
  const queue = createProgressiveChatNarrationQueue({
    batchSize: input.batchSize,
    run,
  });
  const observe = (
    material: LearningMaterialContent,
    completeBlockCount?: number,
  ) => {
    if (!enabled) return;
    queue.observe(material, completeBlockCount);
  };
  return {
    enabled,
    observe,
    finish: queue.finish,
  };
}

async function loadCurrentMaterial(
  userId: string,
  unitId: string,
  sectionId: string | undefined,
  client?: PersistenceClient,
) {
  if (configuredChatNarrationPersistence) {
    const source = await configuredChatNarrationPersistence.loadMaterial({
      userId,
      unitId,
      sectionId,
    });
    return source?.material ? parseLearningMaterial(source.material) : null;
  }
  if (!client) throw new Error("Chat narration persistence is not configured");
  if (sectionId) {
    const section = await client.unitSection.findFirst({
      where: {
        id: sectionId,
        unitId,
        unit: { goal: { userId } },
      },
      include: { material: true },
    });
    if (!section?.material) return null;
    return parseLearningMaterial({
      introduction: section.material.introduction,
      sections: section.material.blocks,
      keyTakeaways: section.material.keyTakeaways,
    });
  }
  const material = await client.learningMaterial.findFirst({
    where: { unitId, unit: { goal: { userId } } },
  });
  return material ? parseLearningMaterial(material) : null;
}

export async function listCurrentChatNarration(input: {
  userId: string;
  unitId: string;
  sectionId?: string;
  client?: PersistenceClient;
}): Promise<ChatNarrationAsset[]> {
  const client = input.client;
  const material = await loadCurrentMaterial(
    input.userId,
    input.unitId,
    input.sectionId,
    client,
  );
  if (!material) return [];
  const portableSource = configuredChatNarrationPersistence
    ? await configuredChatNarrationPersistence.loadMaterial(input)
    : null;
  const unit = portableSource
    ? { goalId: portableSource.goalId }
    : await client!.learningUnit.findFirst({
        where: { id: input.unitId, goal: { userId: input.userId } },
        select: { goalId: true },
      });
  if (!unit) return [];
  const voiceProfile = chatNarrationVoiceProfile(
    await resolveTeachingPersona(input.userId, unit.goalId),
  );
  const audioSettings = await getGlobalChatAudioSettingsSnapshot();
  const userSettings = await getUserSettingsForUser(input.userId).catch(
    () => null,
  );
  const provider = getAudioProvider(
    audioSelectionForProvider(
      audioSettings.provider,
      userSettings?.clientPreferencesJson,
    ),
  );
  const hashes = new Map(
    chatNarrationEntries(material).map((entry) => [
      entry.contentKey,
      chatNarrationTextHash(entry.text, provider.timingVersion),
    ]),
  );
  const rows = configuredChatNarrationPersistence
    ? await configuredChatNarrationPersistence.listReady({
        userId: input.userId,
        unitId: input.unitId,
        scopeKey: input.sectionId || "unit",
        provider: provider.id,
        model: provider.model,
        speaker: voiceProfile.speaker,
      })
    : await client!.chatNarrationAudio.findMany({
        where: {
          userId: input.userId,
          unitId: input.unitId,
          scopeKey: input.sectionId || "unit",
          status: "ready",
          provider: provider.id,
          model: provider.model,
          speaker: voiceProfile.speaker,
        },
        orderBy: { createdAt: "asc" },
      });
  return rows.flatMap((row) => {
    if (hashes.get(row.contentKey) !== row.textHash) return [];
    const asset = assetFromRow(row);
    return asset ? [asset] : [];
  });
}

export async function ensureCurrentChatNarration(input: {
  userId: string;
  unitId: string;
  sectionId?: string;
  signal?: AbortSignal;
  client?: PersistenceClient;
  onReady?: (asset: ChatNarrationAsset) => void | Promise<void>;
}) {
  const client = input.client;
  const portableSource = configuredChatNarrationPersistence
    ? await configuredChatNarrationPersistence.loadMaterial(input)
    : null;
  const unit = portableSource
    ? { goalId: portableSource.goalId }
    : await client!.learningUnit.findFirst({
        where: { id: input.unitId, goal: { userId: input.userId } },
        select: { goalId: true },
      });
  if (!unit) throw new Error("Learning unit not found");
  const material = await loadCurrentMaterial(
    input.userId,
    input.unitId,
    input.sectionId,
    client,
  );
  if (!material) return;
  const coordinator = await createChatNarrationCoordinator({
    ...input,
    goalId: unit.goalId,
    client,
  });
  coordinator.observe(material);
  await coordinator.finish();
}

export async function readOwnedChatNarration(input: {
  userId: string;
  unitId: string;
  audioId: string;
  client?: PersistenceClient;
}) {
  const client = input.client;
  const row = configuredChatNarrationPersistence
    ? await configuredChatNarrationPersistence.findReadyOwned({
        id: input.audioId,
        userId: input.userId,
        unitId: input.unitId,
      })
    : await client!.chatNarrationAudio.findFirst({
        where: {
          id: input.audioId,
          userId: input.userId,
          unitId: input.unitId,
          status: "ready",
        },
      });
  if (!row?.objectKey || !row.mimeType) return null;
  const body = await readChatAudioObject(row.objectKey);
  return body ? { body, mimeType: row.mimeType } : null;
}
