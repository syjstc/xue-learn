import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { tBackend } from "./i18n/backend-i18n.js";
import { resolveUserIdFromRequest } from "./resolve-user-id.js";

@Injectable()
export class RequireAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const userId = resolveUserIdFromRequest(request.headers);
    if (!userId) {
      throw new UnauthorizedException(
        tBackend('error.auth.missingUserIdentity'),
      );
    }
    return true;
  }
}
