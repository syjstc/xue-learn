export type ChatNarrationCharTiming = {
  char: string;
  startMs: number;
  endMs: number;
  endOffset: number;
};

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

export function chatNarrationAssetMatchesText(
  asset: ChatNarrationAsset,
  text: string,
): boolean {
  return (
    asset.chars.length > 0 &&
    asset.chars.map((timing) => timing.char).join("") === text.trim()
  );
}

/**
 * Doubao subtitle timestamps use a slightly shorter clock than the decoded MP3
 * for longer tracks. Scale the provider timeline to the media element's actual
 * duration so drift does not move later batched blocks onto the wrong speech.
 */
export function resolveChatNarrationPlaybackTiming(
  asset: ChatNarrationAsset,
  actualDurationMs: number,
): Pick<ChatNarrationAsset, "audioStartMs" | "audioEndMs" | "chars"> {
  const canScale =
    Number.isFinite(actualDurationMs) &&
    actualDurationMs > 0 &&
    Number.isFinite(asset.durationMs) &&
    asset.durationMs > 0;
  const scale = canScale ? actualDurationMs / asset.durationMs : 1;
  const scaleMs = (value: number) =>
    canScale
      ? Math.max(0, Math.min(actualDurationMs, Math.round(value * scale)))
      : value;

  return {
    audioStartMs: scaleMs(asset.audioStartMs),
    audioEndMs: scaleMs(asset.audioEndMs),
    chars: asset.chars.map((timing) => ({
      ...timing,
      startMs: scaleMs(timing.startMs),
      endMs: scaleMs(timing.endMs),
    })),
  };
}
