import type { Request } from "express";
import { resolveHostRequestUserId } from "./host-identity.js";
export function resolveUserIdFromRequest(headers: Request["headers"]): string | undefined { return resolveHostRequestUserId(headers); }
