import { createParamDecorator, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { tBackend } from "./i18n/backend-i18n.js";
/** Owner identity comes from the host's authenticated ingress. */
export function getUserIdFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const raw = headers['x-user-id'];
  if (!raw) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

export function requireUserIdFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): string {
  const userId = getUserIdFromHeaders(headers);
  if (!userId) {
    throw new UnauthorizedException(tBackend('error.auth.missingUserIdentity'));
  }
  return userId;
}

export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return requireUserIdFromHeaders(request.headers);
  },
);

export const OptionalCurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return getUserIdFromHeaders(request.headers);
  },
);
