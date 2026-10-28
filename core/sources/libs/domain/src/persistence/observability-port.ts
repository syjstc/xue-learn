export type BackendErrorWrite = {
  fingerprint: string;
  source: string;
  service: string;
  errorName?: string;
  errorCode?: string;
  message: string;
  stack?: string;
  statusCode?: number;
  method?: string;
  route?: string;
  operation?: string;
};

export type ApiRequestLogWrite = {
  requestId: string;
  traceId: string;
  userId?: string;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  requestBytes?: number;
  responseBytes?: number;
  platform?: string;
  ipHash?: string;
  userAgentHash?: string;
  errorCode?: string;
  errorMessage?: string;
  errorFingerprint?: string;
};

export type BackendErrorListQuery = {
  since: Date;
  limit: number;
  source?: string;
  service?: string;
  status?: number | "5xx";
  search?: string;
  cursor?: { lastSeenAt: Date; id: string };
};

export type BackendErrorGroupRecord = BackendErrorWrite & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrenceCount: number;
};

export type ApiErrorOccurrenceRecord = {
  id: string;
  createdAt: Date;
  requestId: string;
  traceId: string;
  userId: string | null;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  platform: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export interface ObservabilityRepository {
  upsertBackendError(error: BackendErrorWrite): Promise<void>;
  recordApiRequest(
    request: ApiRequestLogWrite | undefined,
    error: BackendErrorWrite | undefined,
  ): Promise<void>;
  listBackendErrors(query: BackendErrorListQuery): Promise<BackendErrorGroupRecord[]>;
  findBackendError(id: string): Promise<BackendErrorGroupRecord | null>;
  listApiErrorOccurrences(fingerprint: string, limit: number): Promise<ApiErrorOccurrenceRecord[]>;
}
