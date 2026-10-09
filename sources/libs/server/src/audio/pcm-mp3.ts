import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter } from "node:path";

const FFMPEG_CANDIDATES = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/opt/local/bin/ffmpeg",
];

function canExecute(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveFfmpegPath(): string {
  const override = process.env.XUELEARN_FFMPEG?.trim();
  if (override) {
    if (!canExecute(override)) {
      throw new Error(
        `XUELEARN_FFMPEG is not an executable ffmpeg: ${override}`,
      );
    }
    return override;
  }
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = `${directory.replace(/[/\\]$/u, "")}/ffmpeg`;
    if (canExecute(candidate)) return candidate;
  }
  for (const candidate of FFMPEG_CANDIDATES) {
    if (canExecute(candidate)) return candidate;
  }
  throw new Error(
    "FFmpeg was not found. Install it (macOS: brew install ffmpeg) or set XUELEARN_FFMPEG to encode Cartesia Sonic SSE audio.",
  );
}

function runFfmpeg(args: string[], stdin: Buffer): Promise<Buffer> {
  const ffmpeg = resolveFfmpegPath();
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        const detail = Buffer.concat(errors).toString("utf8").trim();
        reject(
          new Error(
            `ffmpeg MP3 encode failed (exit ${code ?? "null"})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
          ),
        );
        return;
      }
      const mp3 = Buffer.concat(chunks);
      if (!mp3.length) {
        reject(new Error("ffmpeg MP3 encode returned empty audio"));
        return;
      }
      resolve(mp3);
    });
    proc.stdin.end(stdin);
  });
}

export function dbToLinearGain(gainDb: number): number {
  return 10 ** (gainDb / 20);
}

/** Soft-clip linear gain on mono PCM s16le. */
export function gainPcmS16le(pcm: Buffer, linearGain: number): Buffer {
  if (!Number.isFinite(linearGain) || linearGain === 1) return pcm;
  const out = Buffer.allocUnsafe(pcm.length);
  for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
    const sample = pcm.readInt16LE(offset);
    out.writeInt16LE(
      Math.max(-32768, Math.min(32767, Math.round(sample * linearGain))),
      offset,
    );
  }
  return out;
}

/** Encode mono PCM s16le to a 128 kbps MP3 the rest of the TTS pipeline can slice. */
export async function encodePcmS16leToMp3(
  pcm: Buffer,
  sampleRate: number,
): Promise<Buffer> {
  if (!pcm.length) throw new Error("Cannot encode empty PCM audio");
  return runFfmpeg(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "s16le",
      "-ar",
      String(sampleRate),
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "-f",
      "mp3",
      "pipe:1",
    ],
    pcm,
  );
}

/** Raise an already-encoded MP3 without changing its timeline. */
export async function boostMp3Volume(
  mp3: Buffer,
  gainDb: number,
): Promise<Buffer> {
  if (!mp3.length) throw new Error("Cannot boost empty MP3 audio");
  if (!Number.isFinite(gainDb) || gainDb === 0) return mp3;
  return runFfmpeg(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "mp3",
      "-i",
      "pipe:0",
      "-filter:a",
      `volume=${gainDb}dB,alimiter=limit=0.95:level=false`,
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "-f",
      "mp3",
      "pipe:1",
    ],
    mp3,
  );
}
