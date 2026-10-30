export type ProviderModel = { id: string; label: string; created?: number };
export type ModelCatalogRequest = {
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
  customProfileId?: string;
  sourceCustomProfileId?: string;
};
export type ProviderModelCatalog = {
  providerId: string;
  models: ProviderModel[];
  fetchedAt: number;
  source: "provider";
  code:
    | "ok"
    | "missing_credentials"
    | "unauthorized"
    | "unavailable"
    | "unsupported"
    | "empty"
    | "invalid_configuration";
};
declare global {
  interface Window {
    xueLearnModelCatalog?: {
      list(request: ModelCatalogRequest): Promise<ProviderModelCatalog>;
      saveCredentials(
        request: ModelCatalogRequest,
      ): Promise<
        import("@xue-learn/core/runtime-contracts").CredentialStatus[]
      >;
    };
  }
}
