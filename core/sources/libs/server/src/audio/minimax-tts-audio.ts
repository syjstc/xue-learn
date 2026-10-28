/** Low–medium quality speech settings (smaller files, fine for narration). */
export const MINIMAX_TTS_AUDIO_SETTING = {
  /** MiniMax mp3 supports: 8000, 16000, 22050, 24000, 32000, 44100 */
  sample_rate: 16_000,
  bitrate: 32_000,
  format: "mp3" as const,
  channel: 1,
};
