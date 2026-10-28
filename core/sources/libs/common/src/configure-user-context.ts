import type { INestApplication } from '@nestjs/common';
import { UserContextInterceptor } from "./user-context.interceptor.js";

export function configureUserContext(app: INestApplication): void {
  app.useGlobalInterceptors(new UserContextInterceptor());
}
