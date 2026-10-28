import { randomUUID } from "node:crypto";
import {
  LOCAL_OWNER_ID,
  parseCustomChatEndpointsState,
  type CustomChatEndpointProfile,
  type CustomChatEndpointsState,
  type CustomThinkingProtocol,
} from "@xue-learn/core/runtime-contracts";
import {
  getUserSettingsForUser,
  upsertUserSettingsForUser,
} from "@xue-learn/core/server/user-settings";
import { saveLlmRuntimeConfig } from "@xue-learn/core/server/llm/runtime-config";

export async function readCustomChatEndpoints(
  userId: string = LOCAL_OWNER_ID,
): Promise<CustomChatEndpointsState> {
  try {
    const row = await getUserSettingsForUser(userId);
    return parseCustomChatEndpointsState(row?.customChatEndpointsJson);
  } catch (error) {
    // Missing migration column (or a transient SQLite read) must not blank the
    // whole AI-models settings payload — return empty profiles instead.
    if (
      error instanceof Error &&
      /no such column|customChatEndpointsJson/i.test(error.message)
    ) {
      return parseCustomChatEndpointsState(null);
    }
    throw error;
  }
}

async function writeCustomChatEndpoints(
  state: CustomChatEndpointsState,
  userId: string = LOCAL_OWNER_ID,
): Promise<CustomChatEndpointsState> {
  const json = JSON.stringify(state);
  await upsertUserSettingsForUser(userId, {
    create: { customChatEndpointsJson: json },
    update: { customChatEndpointsJson: json },
  });
  return state;
}

export async function replaceCustomChatEndpoints(
  state: CustomChatEndpointsState,
  userId: string = LOCAL_OWNER_ID,
): Promise<CustomChatEndpointsState> {
  return writeCustomChatEndpoints(state, userId);
}

export async function upsertCustomChatEndpoint(input: {
  id?: string;
  name: string;
  model: string;
  thinkingProtocol: CustomThinkingProtocol;
  activate?: boolean;
  userId?: string;
}): Promise<CustomChatEndpointsState> {
  const userId = input.userId ?? LOCAL_OWNER_ID;
  const current = await readCustomChatEndpoints(userId);
  const id = input.id ?? randomUUID();
  const profile: CustomChatEndpointProfile = {
    id,
    name: input.name.trim(),
    model: input.model.trim(),
    thinkingProtocol: input.thinkingProtocol,
  };
  if (
    current.profiles.length >= 20 &&
    !current.profiles.some((candidate) => candidate.id === id)
  ) {
    throw new Error("At most 20 OpenAI-compatible endpoints can be saved");
  }
  const profiles = current.profiles.some((candidate) => candidate.id === id)
    ? current.profiles.map((candidate) =>
        candidate.id === id ? profile : candidate,
      )
    : [...current.profiles, profile];
  const activate = input.activate === true;
  const next: CustomChatEndpointsState = {
    activeProfileId: activate
      ? id
      : current.activeProfileId === id
        ? id
        : current.activeProfileId,
    profiles,
  };
  await writeCustomChatEndpoints(next, userId);
  if (activate || current.activeProfileId === id) {
    await saveLlmRuntimeConfig(
      {
        provider: "custom",
        chatModel: profile.model,
        customThinkingProtocol: profile.thinkingProtocol,
      },
      userId,
    );
  }
  return next;
}

export async function deleteCustomChatEndpoint(
  id: string,
  userId: string = LOCAL_OWNER_ID,
): Promise<CustomChatEndpointsState> {
  const current = await readCustomChatEndpoints(userId);
  const profiles = current.profiles.filter((profile) => profile.id !== id);
  const next: CustomChatEndpointsState = {
    activeProfileId:
      current.activeProfileId === id ? null : current.activeProfileId,
    profiles,
  };
  return writeCustomChatEndpoints(next, userId);
}

export async function activateCustomChatEndpoint(
  id: string,
  userId: string = LOCAL_OWNER_ID,
): Promise<CustomChatEndpointsState> {
  const current = await readCustomChatEndpoints(userId);
  const profile = current.profiles.find((candidate) => candidate.id === id);
  if (!profile) {
    throw new Error("OpenAI-compatible endpoint profile not found");
  }
  const next: CustomChatEndpointsState = {
    activeProfileId: id,
    profiles: current.profiles,
  };
  await writeCustomChatEndpoints(next, userId);
  await saveLlmRuntimeConfig(
    {
      provider: "custom",
      chatModel: profile.model,
      customThinkingProtocol: profile.thinkingProtocol,
    },
    userId,
  );
  return next;
}
