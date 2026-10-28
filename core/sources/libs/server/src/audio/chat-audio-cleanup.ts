import {
  chatAudioUserPrefix,
  deleteChatAudioPrefix,
} from "./chat-audio-storage.js";

export const CHAT_AUDIO_CLEANUP_EVENT = "chat.audio.cleanup";

export async function processChatAudioCleanupEvent(payload: string) {
  const parsed = JSON.parse(payload) as { userId?: unknown };
  if (typeof parsed.userId !== "string" || !parsed.userId) {
    throw new Error("invalid chat.audio.cleanup payload");
  }
  return {
    deletedObjects: await deleteChatAudioPrefix(
      chatAudioUserPrefix(parsed.userId),
    ),
  };
}
