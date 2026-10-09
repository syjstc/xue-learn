import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { StaleUserSessionError } from "../../server/src/user-settings.js";
import {
  getRequestContext,
  sanitizeBackendErrorText,
  setRequestContextError,
  shouldCaptureApiStatus,
} from "../../server/src/observability/index.js";
import { localizeBackendMessage, tBackend } from "./i18n/backend-i18n.js";

type RequestWithHeaders = {
  headers?: Record<string, string | string[] | undefined>;
};

export type ApiErrorBody = {
  code: string;
  message: string;
  details?: unknown;
  traceId?: string;
  /** Backwards-compatible NestJS fields. */
  statusCode: number;
  error: string;
};

export type AllExceptionsFilterOptions = Readonly<{
  /**
   * Private runtimes may surface unexpected exception diagnostics to their
   * fixed local owner. Hosted services must retain the safe generic message.
   */
  exposeUnexpectedErrors?: boolean;
}>;

function defaultErrorCode(status: number): string {
  return HttpStatus[status]?.toString() ?? "INTERNAL_SERVER_ERROR";
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly options: AllExceptionsFilterOptions = {}) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest<RequestWithHeaders>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : exception instanceof StaleUserSessionError
          ? HttpStatus.UNAUTHORIZED
          : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionRaw =
      exception instanceof HttpException
        ? exception.getResponse()
        : exception instanceof Error
          ? exception.message
          : tBackend("error.internal");
    const isUnexpected =
      !(exception instanceof HttpException) &&
      !(exception instanceof StaleUserSessionError);
    const raw = isUnexpected
      ? this.options.exposeUnexpectedErrors
        ? sanitizeBackendErrorText(exceptionRaw)
        : tBackend("error.internal")
      : exceptionRaw;
    const structured =
      typeof raw === "object" && raw !== null
        ? (raw as {
            code?: string;
            message?: string | string[];
            details?: unknown;
          })
        : undefined;
    const rawMessage = structured?.message ?? raw;
    const message = Array.isArray(rawMessage)
      ? rawMessage.join(", ")
      : typeof rawMessage === "string"
        ? rawMessage
        : tBackend("error.internal");
    const localizedMessage = localizeBackendMessage(message);
    const traceHeader =
      request?.headers?.["x-trace-id"] ?? request?.headers?.["x-request-id"];
    const traceId =
      getRequestContext()?.traceId ??
      (Array.isArray(traceHeader) ? traceHeader[0] : traceHeader);
    const error = HttpStatus[status]?.toString() ?? "Error";
    const captureStructured =
      typeof exceptionRaw === "object" && exceptionRaw !== null
        ? (exceptionRaw as {
            code?: string;
            message?: string | string[];
          })
        : undefined;
    const captureRawMessage = captureStructured?.message ?? exceptionRaw;
    const captureMessage = Array.isArray(captureRawMessage)
      ? captureRawMessage.join(", ")
      : typeof captureRawMessage === "string"
        ? captureRawMessage
        : tBackend("error.internal");

    if (shouldCaptureApiStatus(status)) {
      setRequestContextError({
        error: exception,
        errorName: exception instanceof Error ? exception.name : undefined,
        errorCode: captureStructured?.code ?? defaultErrorCode(status),
        message: captureMessage,
        stack: exception instanceof Error ? exception.stack : undefined,
        statusCode: status,
      });
    }

    const body: ApiErrorBody = {
      code: structured?.code ?? defaultErrorCode(status),
      message: localizedMessage,
      statusCode: status,
      error,
      ...(structured?.details === undefined
        ? {}
        : { details: structured.details }),
      ...(isUnexpected &&
      this.options.exposeUnexpectedErrors &&
      exception instanceof Error
        ? {
            details: {
              name: exception.name,
              stack: exception.stack
                ? sanitizeBackendErrorText(exception.stack, 8_192)
                : undefined,
            },
          }
        : {}),
      ...(traceId ? { traceId } : {}),
    };

    response.status(status).json(body);
  }
}
