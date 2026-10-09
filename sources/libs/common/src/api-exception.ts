import { localizeBackendMessage, tBackend } from "./i18n/backend-i18n.js";

export type ApiExceptionDetails = {
  message: string;
  code?: string;
  status?: number;
};

type HttpExceptionLike = {
  getResponse(): unknown;
  getStatus(): number;
};

function isHttpExceptionLike(error: unknown): error is HttpExceptionLike {
  return (
    !!error &&
    typeof error === 'object' &&
    typeof (error as HttpExceptionLike).getResponse === 'function' &&
    typeof (error as HttpExceptionLike).getStatus === 'function'
  );
}

function readStructuredMessage(
  message: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' ? message : undefined;
}

export function formatApiException(error: unknown): ApiExceptionDetails {
  if (isHttpExceptionLike(error)) {
    const raw = error.getResponse();
    const status = error.getStatus();
    if (typeof raw === 'object' && raw !== null) {
      const structured = raw as {
        code?: string;
        message?: string | string[];
      };
      const message = readStructuredMessage(structured.message);
      return {
        code: structured.code,
        message: message
          ? localizeBackendMessage(message)
          : tBackend('error.internal'),
        status,
      };
    }
    if (typeof raw === 'string') {
      return {
        message: localizeBackendMessage(raw),
        status,
      };
    }
  }

  if (error instanceof Error) {
    return { message: localizeBackendMessage(error.message) };
  }

  return { message: tBackend('error.unknown') };
}
