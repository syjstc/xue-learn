import type { DesktopPluginCapabilityContext } from "./manager";
import type { DesktopHostCapabilities } from "./host-capabilities";
import {
  readCompletedUnitPreview,
  UnitPreviewCapabilityError,
  unitPreviewMessage,
} from "./unit-preview-capability";
import { DESKTOP_PLUGIN_UI_SLOTS } from "../../../../packages/plugin-sdk/src/index";

/** Sessions stay in Desktop main; plugins receive only the requested domain result. */
export interface CorePluginCapabilityOptions {
  getSession(
    workspaceId: string,
    signal: AbortSignal,
  ): Promise<{ baseUrl: string; token: string }>;
  request?: typeof fetch;
  timeoutMs?: number;
}

function argumentsFor(
  input: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (input === undefined && fields.length === 0) return {};
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    throw Error("Invalid host capability arguments");
  return input as Record<string, unknown>;
}

function resourceId(
  input: unknown,
  field: "unitId" | "id" | "resourceId",
): string {
  const value = argumentsFor(input, [field])[field];
  // Keep every identifier in one URL segment, including before URL normalization.
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 200 ||
    value === "." ||
    value === ".." ||
    /[\\/\u0000-\u0020\u007f]/.test(value)
  )
    throw Error(`Invalid ${field}`);
  return encodeURIComponent(value);
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let cancel!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

/** Reuse the owning workspace's authenticated controllers and configured Core services. */
export async function registerCorePluginCapabilities(
  host: DesktopHostCapabilities,
  options: CorePluginCapabilityOptions,
): Promise<() => Promise<void>> {
  const request = options.request ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw Error("Invalid host capability timeout");

  async function call(
    context: DesktopPluginCapabilityContext,
    path: string,
    method = "GET",
    body?: unknown,
    missingIsNull = false,
    binary = false,
    previewLocale?: string,
    teachingLocale?: string,
  ) {
    context.signal.throwIfAborted();
    const timeout = new AbortController();
    const timer = setTimeout(
      () =>
        timeout.abort(
          previewLocale
            ? new UnitPreviewCapabilityError(
                unitPreviewMessage(previewLocale, "timeout"),
                503,
              )
            : new Error("Host capability request timed out"),
        ),
      previewLocale || teachingLocale ? 60 * 60_000 : timeoutMs,
    );
    const signal = AbortSignal.any([context.signal, timeout.signal]);
    try {
      const session = await abortable(
        options.getSession(context.workspaceId, signal),
        signal,
      );
      signal.throwIfAborted();
      const origin = new URL(session.baseUrl);
      if (
        origin.protocol !== "http:" ||
        origin.hostname !== "127.0.0.1" ||
        origin.pathname !== "/" ||
        origin.username ||
        origin.password ||
        origin.search ||
        origin.hash ||
        !session.token
      )
        throw Error("Invalid host workspace session");
      const response = await abortable(
        request(`${origin.origin}${path}`, {
          method,
          signal,
          redirect: "error",
          headers: {
            Authorization: `Bearer ${session.token}`,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...(previewLocale
              ? {
                  Accept: "text/event-stream",
                  "Accept-Language": previewLocale,
                }
              : teachingLocale
                ? { "Accept-Language": teachingLocale }
                : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        signal,
      );
      if (previewLocale)
        return await readCompletedUnitPreview(response, signal, previewLocale);
      if (missingIsNull && response.status === 404) return null;
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw Error(
          error.message ||
            `Host workspace operation failed (${response.status})`,
        );
      }
      if (binary)
        return {
          data: new Uint8Array(await abortable(response.arrayBuffer(), signal)),
          mediaType:
            response.headers.get("content-type") ?? "application/octet-stream",
        };
      return await abortable(response.json(), signal);
    } catch (error) {
      if (previewLocale && error instanceof TypeError)
        throw new UnitPreviewCapabilityError(
          unitPreviewMessage(previewLocale, "disconnected"),
          503,
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  const disposers: Array<() => Promise<void>> = [];
  try {
    disposers.push(
      await host.register("ui.extensions", 1, {
        describe: async (args) => {
          argumentsFor(args, []);
          return { slots: [...DESKTOP_PLUGIN_UI_SLOTS] };
        },
      }),
    );
    disposers.push(
      await host.register("learning.preview", 1, {
        ensure: (args, context) => {
          const { unitId, locale = "zh-Hans" } = argumentsFor(args, [
            "unitId",
            "locale",
          ]);
          const unit = resourceId({ unitId }, "unitId");
          if (locale !== "zh-Hans" && locale !== "zh-Hant" && locale !== "en")
            throw Error("Invalid preview locale");
          return call(
            context,
            `/api/units/${unit}/session/stream`,
            "POST",
            { action: "generate_sq", onlyIfMissing: true },
            false,
            false,
            locale,
          );
        },
      }),
    );
    disposers.push(
      await host.register("workspace.courses", 1, {
        catalog: (args, context) => {
          argumentsFor(args, []);
          return call(context, "/api/course-sources/catalog");
        },
        readUnit: (args, context) =>
          call(
            context,
            `/api/course-sources/units/${resourceId(args, "unitId")}`,
            "GET",
            undefined,
            true,
          ),
        readAsset: (args, context) => {
          const {
            unitId,
            resourceId: assetId,
            sha256,
          } = argumentsFor(args, ["unitId", "resourceId", "sha256"]);
          if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256))
            throw Error("Invalid asset sha256");
          const unit = resourceId({ unitId }, "unitId"),
            asset = resourceId({ resourceId: assetId }, "resourceId");
          return call(
            context,
            `/api/course-sources/units/${unit}/assets/${asset}?sha256=${sha256}`,
            "GET",
            undefined,
            false,
            true,
          );
        },
      }),
    );
    disposers.push(
      await host.register("learning.content", 1, {
        read: (args, context) =>
          call(
            context,
            `/api/course-sources/units/${resourceId(args, "unitId")}/teaching`,
            "GET",
            undefined,
            true,
          ),
        ensure: (args, context) => {
          const {
            unitId,
            locale = "zh-Hans",
            reuse,
          } = argumentsFor(args, ["unitId", "locale", "reuse"]);
          const unit = resourceId({ unitId }, "unitId");
          if (!["zh-Hans", "zh-Hant", "en"].includes(String(locale)))
            throw Error("Invalid teaching locale");
          return call(
            context,
            `/api/course-sources/units/${unit}/teaching/ensure`,
            "POST",
            reuse === undefined ? {} : { reuse },
            false,
            false,
            undefined,
            String(locale),
          );
        },
      }),
    );
    disposers.push(
      await host.register("generation.settings", 1, {
        get: (args, context) => {
          argumentsFor(args, []);
          return call(context, "/api/local/generation-settings");
        },
        updateGlobal: (args, context) => {
          const { patch } = argumentsFor(args, ["patch"]);
          if (!patch || typeof patch !== "object" || Array.isArray(patch))
            throw Error("Invalid generation settings patch");
          return call(
            context,
            "/api/local/generation-settings/global",
            "PATCH",
            { patch },
          );
        },
        updateUser: (args, context) => {
          const { patch } = argumentsFor(args, ["patch"]);
          if (!patch || typeof patch !== "object" || Array.isArray(patch))
            throw Error("Invalid generation settings patch");
          return call(context, "/api/local/generation-settings/user", "PATCH", {
            patch,
          });
        },
      }),
    );
    disposers.push(
      await host.register("display.workspace", 1, {
        plugins: (args, context) => {
          argumentsFor(args, []);
          return call(context, "/api/local/display-plugins");
        },
        resolveDocument: (args, context) => {
          const { document } = argumentsFor(args, ["document"]);
          if (
            !document ||
            typeof document !== "object" ||
            Array.isArray(document)
          )
            throw Error("Invalid display document");
          return call(context, "/api/local/display-builds/resolve", "POST", {
            document,
          });
        },
        getBuild: (args, context) =>
          call(
            context,
            `/api/local/display-builds/${resourceId(args, "id")}`,
            "GET",
            undefined,
            true,
          ),
        retryBuild: (args, context) =>
          call(
            context,
            `/api/local/display-builds/${resourceId(args, "id")}/retry`,
            "POST",
            {},
          ),
        cancelBuild: (args, context) =>
          call(
            context,
            `/api/local/display-builds/${resourceId(args, "id")}/cancel`,
            "POST",
            {},
          ),
      }),
    );
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose();
    throw error;
  }
  return async () => {
    for (const dispose of disposers.splice(0).reverse()) await dispose();
  };
}
