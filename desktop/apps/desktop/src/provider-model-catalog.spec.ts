import {
  listProviderModels,
  providerCredentialsForSave,
} from "./provider-model-catalog";
const reply = (data: unknown, status = 200) =>
  ({
    ok: status === 200,
    status,
    text: async () => JSON.stringify(data),
  }) as Response;
describe("live provider model catalog", () => {
  it("requires an explicitly entered key when saving a different generic host", () => {
    const credentials = {
      custom: { apiKey: "old-key", baseUrl: "https://old.example/v1" },
    };
    expect(() =>
      providerCredentialsForSave(
        { providerId: "custom", baseUrl: "https://new.example/v1" },
        credentials,
      ),
    ).toThrow(/Enter a key/);
    expect(
      providerCredentialsForSave(
        {
          providerId: "custom",
          baseUrl: "https://new.example/v1",
          apiKey: "new-key",
        },
        credentials,
      ),
    ).toEqual({ apiKey: "new-key", baseUrl: "https://new.example/v1" });
    expect(() =>
      providerCredentialsForSave(
        { providerId: "custom", baseUrl: "file:///private", apiKey: "new-key" },
        credentials,
      ),
    ).toThrow(/Invalid provider address/);
  });
  it("reads previously unknown models from the selected provider without a bundled fallback", async () => {
    const fetcher = jest.fn().mockResolvedValue(
      reply({
        data: [
          { id: "brand-new-model-2030", created: 90 },
          { id: "previous-model", created: 10 },
        ],
      }),
    );
    const result = await listProviderModels(
      { providerId: "deepseek" },
      { deepseek: { apiKey: "test-key" } },
      fetcher,
    );
    expect(result.code).toBe("ok");
    expect(result.models.map((m) => m.id)).toEqual([
      "brand-new-model-2030",
      "previous-model",
    ]);
    expect(fetcher.mock.calls[0][0].toString()).toBe(
      "https://api.deepseek.com/models",
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer test-key" },
      redirect: "error",
    });
  });
  it("can discover a new generic endpoint without saving its key or changing current credentials", async () => {
    const credentials = {
      custom: {
        apiKey: "previous-key",
        baseUrl: "https://previous.example/v1",
      },
    };
    const fetcher = jest
      .fn()
      .mockResolvedValue(reply({ data: [{ id: "vendor-current" }] }));
    const result = await listProviderModels(
      {
        providerId: "custom",
        baseUrl: "https://new.example/v1",
        apiKey: "new-key",
      },
      credentials,
      fetcher,
    );
    expect(result.models[0]?.id).toBe("vendor-current");
    expect(fetcher.mock.calls[0][0].toString()).toBe(
      "https://new.example/v1/models",
    );
    expect(credentials.custom.apiKey).toBe("previous-key");
  });
  it("does not send a saved generic key to a newly entered host", async () => {
    const fetcher = jest.fn();
    const result = await listProviderModels(
      { providerId: "custom", baseUrl: "https://new.example/v1" },
      { custom: { apiKey: "saved-key", baseUrl: "https://old.example/v1" } },
      fetcher,
    );
    expect(result.code).toBe("missing_credentials");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the installed Ollama inventory and no API key", async () => {
    const fetcher = jest.fn().mockResolvedValue(
      reply({
        models: [{ name: "local-new:latest" }, { name: "embedding-model" }],
      }),
    );
    const result = await listProviderModels(
      { providerId: "ollama" },
      {},
      fetcher,
    );
    expect(fetcher.mock.calls[0][0].toString()).toBe(
      "http://127.0.0.1:11434/api/tags",
    );
    expect(result.models.map((m) => m.id)).toEqual(["local-new:latest"]);
  });
  it("filters non-chat resources, deduplicates and follows provider pagination", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(
        reply({
          data: [{ id: "new-chat" }, { id: "text-embedding-current" }],
          has_more: true,
          last_id: "new-chat",
        }),
      )
      .mockResolvedValueOnce(
        reply({ data: [{ id: "new-chat" }, { id: "second-chat" }] }),
      );
    const result = await listProviderModels(
      { providerId: "openai", apiKey: "new-key" },
      {},
      fetcher,
    );
    expect(result.models.map((m) => m.id)).toEqual(["new-chat", "second-chat"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    [401, "unauthorized"],
    [404, "unsupported"],
    [500, "unavailable"],
  ])(
    "returns a safe reason for HTTP %s without stale fixed model IDs",
    async (status, code) => {
      const fetcher = jest
        .fn()
        .mockResolvedValue(
          reply({ error: "private provider detail" }, status as number),
        );
      const result = await listProviderModels(
        { providerId: "minimax", apiKey: "test-key" },
        {},
        fetcher,
      );
      expect(result.code).toBe(code);
      expect(result.models).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("private provider detail");
    },
  );
  it("finishes a failed network request without exposing the key in diagnostics", async () => {
    const result = await listProviderModels(
      { providerId: "deepseek", apiKey: "secret-test" },
      {},
      jest.fn().mockRejectedValue(Error("Bearer secret-test")),
    );
    expect(result.code).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("secret-test");
  });
});
