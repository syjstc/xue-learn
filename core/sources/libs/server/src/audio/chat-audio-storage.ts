import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "../env.js";

type CosSdk = {
  putObject(
    params: {
      Bucket: string;
      Region: string;
      Key: string;
      Body: Buffer;
      ContentType: string;
      CacheControl: string;
    },
    callback: (error?: Error | null) => void,
  ): void;
  getObject(
    params: { Bucket: string; Region: string; Key: string },
    callback: (error?: Error | null, data?: { Body?: Buffer }) => void,
  ): void;
  getBucket(
    params: {
      Bucket: string;
      Region: string;
      Prefix: string;
      Marker?: string;
      MaxKeys: number;
    },
    callback: (
      error?: Error | null,
      data?: {
        Contents?: Array<{ Key?: string }>;
        IsTruncated?: string;
        NextMarker?: string;
      },
    ) => void,
  ): void;
  deleteMultipleObject(
    params: {
      Bucket: string;
      Region: string;
      Objects: Array<{ Key: string }>;
    },
    callback: (error?: Error | null) => void,
  ): void;
};

function cosClient(): CosSdk | null {
  const env = getEnv();
  if (
    !env.MEDIA_COS_SECRET_ID?.trim() ||
    !env.MEDIA_COS_SECRET_KEY?.trim() ||
    !env.MEDIA_COS_BUCKET?.trim() ||
    !env.MEDIA_COS_REGION?.trim()
  ) {
    return null;
  }
  try {
    const load = createRequire(__filename);
    const Cos = load("cos-nodejs-sdk-v5") as new (options: {
      SecretId: string;
      SecretKey: string;
    }) => CosSdk;
    return new Cos({
      SecretId: env.MEDIA_COS_SECRET_ID,
      SecretKey: env.MEDIA_COS_SECRET_KEY,
    });
  } catch {
    throw new Error("cos-nodejs-sdk-v5 is required for private media storage");
  }
}

export function chatAudioObjectKey(
  userId: string,
  unitId: string,
  audioId: string,
): string {
  const prefix =
    getEnv().MEDIA_COS_PREFIX.replace(/^\/+|\/+$/g, "") || "chat-audio/v1";
  return `${prefix}/${userId}/${unitId}/${audioId}.mp3`;
}

function localPath(objectKey: string): string {
  const normalized = path.posix.normalize(objectKey).replace(/^(\.\.\/)+/, "");
  return path.join(getEnv().AUDIO_STORAGE_DIR, "chat-audio", normalized);
}

function requireDevelopmentFallback(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "MEDIA_COS_* credentials are required for private media in production",
    );
  }
}

export async function saveChatAudioObject(
  objectKey: string,
  body: Buffer,
): Promise<void> {
  const client = cosClient();
  const env = getEnv();
  if (!client) {
    requireDevelopmentFallback();
    const file = localPath(objectKey);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    client.putObject(
      {
        Bucket: env.MEDIA_COS_BUCKET!,
        Region: env.MEDIA_COS_REGION!,
        Key: objectKey,
        Body: body,
        ContentType: "audio/mpeg",
        CacheControl: "private, max-age=31536000, immutable",
      },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

export async function readChatAudioObject(
  objectKey: string,
): Promise<Buffer | null> {
  const client = cosClient();
  const env = getEnv();
  if (!client) {
    requireDevelopmentFallback();
    try {
      return await readFile(localPath(objectKey));
    } catch {
      return null;
    }
  }
  return new Promise((resolve, reject) => {
    client.getObject(
      {
        Bucket: env.MEDIA_COS_BUCKET!,
        Region: env.MEDIA_COS_REGION!,
        Key: objectKey,
      },
      (error, data) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Buffer.isBuffer(data?.Body) ? data!.Body! : null);
      },
    );
  });
}

export async function deleteChatAudioPrefix(prefix: string): Promise<number> {
  const client = cosClient();
  const env = getEnv();
  const normalized = prefix.replace(/^\/+|\/+$/g, "");
  if (!client) {
    requireDevelopmentFallback();
    await rm(localPath(normalized), { recursive: true, force: true });
    return 1;
  }
  let marker: string | undefined;
  let deleted = 0;
  for (;;) {
    const page = await new Promise<{
      keys: string[];
      truncated: boolean;
      nextMarker?: string;
    }>((resolve, reject) => {
      client.getBucket(
        {
          Bucket: env.MEDIA_COS_BUCKET!,
          Region: env.MEDIA_COS_REGION!,
          Prefix: `${normalized}/`,
          Marker: marker,
          MaxKeys: 1000,
        },
        (error, data) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({
            keys: (data?.Contents ?? []).flatMap((item) =>
              item.Key ? [item.Key] : [],
            ),
            truncated: data?.IsTruncated === "true",
            nextMarker: data?.NextMarker,
          });
        },
      );
    });
    if (page.keys.length > 0) {
      await new Promise<void>((resolve, reject) => {
        client.deleteMultipleObject(
          {
            Bucket: env.MEDIA_COS_BUCKET!,
            Region: env.MEDIA_COS_REGION!,
            Objects: page.keys.map((Key) => ({ Key })),
          },
          (error) => (error ? reject(error) : resolve()),
        );
      });
      deleted += page.keys.length;
    }
    if (!page.truncated || !page.nextMarker) break;
    marker = page.nextMarker;
  }
  return deleted;
}

export function chatAudioUserPrefix(userId: string): string {
  const prefix =
    getEnv().MEDIA_COS_PREFIX.replace(/^\/+|\/+$/g, "") || "chat-audio/v1";
  return `${prefix}/${userId}`;
}
