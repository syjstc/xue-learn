import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { readStagedGuidedImageCandidate } from "./guided-image-repair-candidate.js";

let root: string;
const identity = { unitId: "unit-1", scopeId: "a".repeat(64), fingerprint: "b".repeat(64), rejectedSha256: "c".repeat(64) };
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const dir = () => path.join(root, identity.unitId, "guided-repair-candidates");
const manifestPath = () => path.join(dir(), `${identity.scopeId}-${identity.rejectedSha256}.json`);
const input = () => ({ imageStorageDir: root, ...identity });
async function stage(bytes: Buffer, overrides: Record<string, unknown> = {}) {
  await mkdir(dir(), { recursive: true });
  const candidateSha256 = hash(bytes);
  await writeFile(path.join(dir(), `${candidateSha256}.png`), bytes);
  await writeFile(manifestPath(), JSON.stringify({ version: 1, ...identity, candidateSha256, ...overrides }));
  return candidateSha256;
}
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "guided-candidate-test-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const png = () => sharp({ create: { width: 320, height: 256, channels: 3, background: "#eeeeee" } }).png().toBuffer();

it("returns no override when this rejected checkpoint has no staged candidate", async () => {
  await expect(readStagedGuidedImageCandidate(input())).resolves.toBeUndefined();
});
it("loads only the exact staged PNG and preserves its original bytes", async () => {
  const pixels = await png(); await stage(pixels);
  expect(await readStagedGuidedImageCandidate(input())).toEqual(pixels);
});
it("fails closed when the manifest identifies a different frozen intent", async () => {
  await stage(await png(), { fingerprint: "d".repeat(64) });
  await expect(readStagedGuidedImageCandidate(input())).rejects.toThrow("does not match");
});
it("fails closed when a staged image has been replaced", async () => {
  const name = await stage(await png());
  await writeFile(path.join(dir(), `${name}.png`), Buffer.from("changed"));
  await expect(readStagedGuidedImageCandidate(input())).rejects.toThrow("missing or changed");
});
it("rejects symlinks and rejects non-PNG payloads", async () => {
  await mkdir(dir(), { recursive: true });
  await symlink(path.join(root, "elsewhere"), manifestPath());
  await expect(readStagedGuidedImageCandidate(input())).rejects.toThrow();
  await rm(manifestPath());
  await stage(Buffer.from("not an image"));
  await expect(readStagedGuidedImageCandidate(input())).rejects.toThrow();
});
it("rejects traversal and malformed checkpoint identities", async () => {
  await expect(readStagedGuidedImageCandidate({ ...input(), unitId: "../other" })).rejects.toThrow("identity");
  await expect(readStagedGuidedImageCandidate({ ...input(), scopeId: "short" })).rejects.toThrow("identity");
});
