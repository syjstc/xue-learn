import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithUserId } from "../../server/src/user-context.js";
import { setRequestContextUserId } from "../../server/src/observability/index.js";
import { resolveUserIdFromRequest } from "./resolve-user-id.js";

@Injectable()
export class UserContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const userId = resolveUserIdFromRequest(request.headers);
    setRequestContextUserId(userId);
    if (!userId) {
      return next.handle();
    }

    return new Observable((subscriber) => {
      runWithUserId(userId, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
