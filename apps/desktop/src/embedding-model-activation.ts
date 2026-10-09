import { BUILTIN_EMBEDDING_MODEL_ID } from "@xue-learn/core/runtime-contracts";

type RestartableSidecar = {
  restart(): Promise<unknown>;
  getSession(): { baseUrl: string; token: string } | null;
};

/** Restarts with the verified model path, then selects it in the new sidecar. */
export async function activateInstalledBuiltinEmbedding(
  sidecar: RestartableSidecar,
  request: typeof fetch = fetch,
): Promise<void> {
  await sidecar.restart();
  const session = sidecar.getSession();
  if (!session) {
    throw new Error(
      "The local service did not become available after installing Qwen",
    );
  }
  const response = await request(`${session.baseUrl}/api/local/ai-models`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      capability: "embedding",
      providerId: "builtin",
      model: BUILTIN_EMBEDDING_MODEL_ID,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Qwen could not be enabled after installation (${response.status})`,
    );
  }
}
