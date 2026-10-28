import type { INestApplication } from "@nestjs/common";
import {
  logApiRequest,
  getRequestContext,
  resolveIncomingRequestIds,
  runWithRequestContext,
} from "../../server/src/observability/index.js";
import { resolveUserIdFromRequest } from "./resolve-user-id.js";

type ExpressLikeRequest = {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  originalUrl?: string;
  path?: string;
  route?: { path?: string };
  ip?: string;
  socket?: { remoteAddress?: string };
};

type ExpressLikeResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  getHeader(name: string): number | string | string[] | undefined;
  once(event: "finish" | "close", listener: () => void): void;
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function routeFor(req: ExpressLikeRequest): string {
  const raw = req.originalUrl ?? req.path ?? "";
  const path = raw.split("?")[0] || "/";
  const route = req.route?.path ? String(req.route.path) : path;
  return route
    .replace(/[0-9a-f]{24}/gi, ":id")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
      ":id",
    )
    .replace(/\/[a-z0-9_-]{18,}(?=\/|$)/gi, "/:id");
}

function numberHeader(
  value: number | string | string[] | undefined,
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function configureRequestContext(
  app: INestApplication,
  options: { serviceName: string },
): void {
  app.use(
    (req: ExpressLikeRequest, res: ExpressLikeResponse, next: () => void) => {
      const startedAt = Date.now();
      const { requestId, traceId } = resolveIncomingRequestIds(req.headers);
      const userId = resolveUserIdFromRequest(req.headers);
      const route = routeFor(req);

      res.setHeader("x-request-id", requestId);
      res.setHeader("x-trace-id", traceId);

      runWithRequestContext(
        {
          requestId,
          traceId,
          userId,
          method: req.method,
          route,
          startedAt,
          service: options.serviceName,
        },
        () => {
          res.once("finish", () => {
            const latestContext = getRequestContext();
            logApiRequest({
              requestId,
              traceId,
              userId: latestContext?.userId ?? userId,
              method: req.method,
              route,
              service: options.serviceName,
              statusCode: res.statusCode,
              durationMs: Date.now() - startedAt,
              requestBytes: numberHeader(req.headers["content-length"]),
              responseBytes: numberHeader(res.getHeader("content-length")),
              platform: firstHeader(req.headers["x-platform"]),
              ip:
                firstHeader(req.headers["x-forwarded-for"]) ??
                req.ip ??
                req.socket?.remoteAddress,
              userAgent: firstHeader(req.headers["user-agent"]),
              error: latestContext?.error,
            });
          });
          next();
        },
      );
    },
  );
}
