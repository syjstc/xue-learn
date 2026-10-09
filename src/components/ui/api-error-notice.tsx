import { RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import {
  resolveUserFacingApiError,
  type ApiErrorKind,
} from "@/shared/api/user-facing-error";
import { useT, type TranslationKey } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { cn } from "@xue-learn/core/source/src/lib/utils.ts";

const KIND_TITLE_KEYS: Record<ApiErrorKind, TranslationKey> = {
  network: "errors.networkTitle",
  unauthorized: "errors.unauthorizedTitle",
  forbidden: "errors.forbiddenTitle",
  not_found: "errors.notFoundTitle",
  conflict: "errors.conflictTitle",
  rate_limit: "errors.rateLimitTitle",
  payment: "errors.paymentTitle",
  timeout: "errors.timeoutTitle",
  bad_request: "errors.badRequestTitle",
  server: "errors.serverTitle",
  unknown: "errors.unknownTitle",
};

const KIND_MESSAGE_KEYS: Record<ApiErrorKind, TranslationKey> = {
  network: "errors.network",
  unauthorized: "errors.unauthorized",
  forbidden: "errors.forbidden",
  not_found: "errors.notFound",
  conflict: "errors.conflict",
  rate_limit: "errors.rateLimit",
  payment: "errors.payment",
  timeout: "errors.timeout",
  bad_request: "errors.badRequest",
  server: "errors.server",
  unknown: "errors.unknown",
};

export function ApiErrorNotice({
  error,
  title,
  fallback,
  onRetry,
  className,
}: {
  error: unknown;
  title?: string;
  fallback?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useT();
  const resolved = resolveUserFacingApiError(error, fallback);
  const description = resolved.isDomainMessage
    ? resolved.message
    : t(KIND_MESSAGE_KEYS[resolved.kind]);
  const resolvedTitle = title ?? t(KIND_TITLE_KEYS[resolved.kind]);
  const Icon = resolved.kind === "network" ? WifiOff : TriangleAlert;

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-[var(--error-200)] bg-[var(--error-50)] px-4 py-4 text-[var(--error-700)] sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon
          className="mt-0.5 size-5 shrink-0 text-[var(--error-500)]"
          aria-hidden
        />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-[var(--error-700)]">
            {resolvedTitle}
          </p>
          <p className="text-sm text-[var(--error-600)]">{description}</p>
        </div>
      </div>
      {onRetry ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 self-start border-[var(--error-200)] bg-white/70 text-[var(--error-700)] hover:bg-white"
          onClick={onRetry}
        >
          <RefreshCw className="size-3.5" aria-hidden />
          {t("errors.retry")}
        </Button>
      ) : null}
    </div>
  );
}
