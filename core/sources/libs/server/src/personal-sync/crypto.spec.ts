import {
  createWrappedWorkspaceKey,
  decryptSyncPayload,
  encryptSyncPayload,
  rewrapWorkspaceKey,
  unwrapWorkspaceKey,
} from "./crypto.js";

const workspaceId = "2f551cc2-c374-4bc0-9701-b24d3890d8ab";

describe("personal sync encryption", () => {
  jest.setTimeout(30_000);

  it("wraps a workspace key and authenticates compressed payloads", async () => {
    const created = await createWrappedWorkspaceKey(
      workspaceId,
      "correct horse battery staple",
    );
    const unwrapped = await unwrapWorkspaceKey(
      workspaceId,
      "correct horse battery staple",
      created.bundle,
    );
    expect(unwrapped.equals(created.workspaceKey)).toBe(true);

    const envelope = await encryptSyncPayload({
      workspaceId,
      valueId: "5d119cc9-9bd2-474a-b74e-2250847f57ea",
      purpose: "commit",
      workspaceKey: unwrapped,
      plaintext: Buffer.from(JSON.stringify({ repeated: "x".repeat(2_000) })),
    });
    const plaintext = await decryptSyncPayload({
      workspaceId,
      valueId: "5d119cc9-9bd2-474a-b74e-2250847f57ea",
      purpose: "commit",
      workspaceKey: created.workspaceKey,
      envelope,
    });
    expect(JSON.parse(plaintext.toString("utf8"))).toEqual({
      repeated: "x".repeat(2_000),
    });
  });

  it("rejects a wrong passphrase and tampered associated data", async () => {
    const created = await createWrappedWorkspaceKey(
      workspaceId,
      "a sufficiently long passphrase",
    );
    await expect(
      unwrapWorkspaceKey(workspaceId, "another long passphrase", created.bundle),
    ).rejects.toThrow("incorrect or the key bundle is damaged");

    const envelope = await encryptSyncPayload({
      workspaceId,
      valueId: "commit-a",
      purpose: "commit",
      workspaceKey: created.workspaceKey,
      plaintext: Buffer.from("private"),
    });
    await expect(
      decryptSyncPayload({
        workspaceId,
        valueId: "commit-b",
        purpose: "commit",
        workspaceKey: created.workspaceKey,
        envelope,
      }),
    ).rejects.toThrow();
  });

  it("rewraps the same key under a replacement passphrase", async () => {
    const created = await createWrappedWorkspaceKey(
      workspaceId,
      "the original long passphrase",
    );
    const rewrapped = await rewrapWorkspaceKey({
      workspaceId,
      currentPassphrase: "the original long passphrase",
      nextPassphrase: "the replacement long passphrase",
      bundle: created.bundle,
    });
    const key = await unwrapWorkspaceKey(
      workspaceId,
      "the replacement long passphrase",
      rewrapped,
    );
    expect(key.equals(created.workspaceKey)).toBe(true);
  });
});

