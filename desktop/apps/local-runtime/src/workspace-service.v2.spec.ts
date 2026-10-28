import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { WorkspaceServiceOwner, workspaceServiceGuardPort } from "./workspace-service-owner.ts";
import { WorkspaceServiceSessions } from "./workspace-service-sessions.ts";

describe("workspace service ownership and scoped sessions", () => {
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "workspace-service-")); });
  afterEach(() => rmSync(directory, {recursive: true, force: true}));
  it("permits one migration/recovery owner and publishes no credentials", async () => {
    const owner = await WorkspaceServiceOwner.acquire({dataPath: directory, workspaceId: "workspace", instanceId: randomUUID()});
    owner.publish({protocolVersion: 1, coreContractVersion: "course-source.v1", endpoint: "http://127.0.0.1:43123", capabilities: ["course.content.read"], startedAt: new Date().toISOString()});
    await expect(WorkspaceServiceOwner.acquire({dataPath: directory, workspaceId: "workspace", instanceId: randomUUID()})).rejects.toThrow("ALREADY_RUNNING");
    const discovery = readFileSync(owner.discoveryPath, "utf8");
    expect(discovery).not.toMatch(/token|credential|secret/i);
    expect(owner.discover()?.workspaceId).toBe("workspace");
    await owner.release();
    const next = await WorkspaceServiceOwner.acquire({dataPath: directory, workspaceId: "workspace", instanceId: randomUUID()});
    await next.release();
  });
  it("recovers after a real owning process crash without trusting stale PID metadata", async () => {
    const port = workspaceServiceGuardPort(directory);
    const child = spawn(process.execPath, ["-e", `require('node:net').createServer(s=>s.destroy()).listen({host:'127.0.0.1',port:${port},exclusive:true},()=>process.stdout.write('ready'));`], {stdio: ["ignore", "pipe", "pipe"]});
    await new Promise<void>((ready, reject) => { child.stdout.once("data", () => ready()); child.once("error", reject); child.once("exit", code => reject(new Error(`Guard fixture exited before readiness (${code})`))); });
    mkdirSync(join(directory, ".workspace-service.lock"));
    writeFileSync(join(directory, ".workspace-service.lock", "owner.json"), JSON.stringify({pid: child.pid, epoch: "old", workspaceId: "workspace"}));
    await expect(WorkspaceServiceOwner.acquire({dataPath: directory, workspaceId: "workspace", instanceId: randomUUID()})).rejects.toThrow("ALREADY_RUNNING");
    child.kill("SIGKILL");
    await new Promise<void>(done => child.once("exit", () => done()));
    const next = await WorkspaceServiceOwner.acquire({dataPath: directory, workspaceId: "workspace", instanceId: randomUUID()});
    const current = JSON.parse(readFileSync(join(directory, ".workspace-service.lock", "owner.json"), "utf8"));
    expect(current.epoch).toBe(next.epoch);
    await next.release();
  });
  it("fences workspace, capability, epoch, expiration and individual disconnects", () => {
    let now = 1_800_000_000_000;
    const sessions = new WorkspaceServiceSessions("workspace", "owner", randomUUID(), randomUUID(), () => now, 1000);
    const request = {protocolVersion: 1 as const, workspaceId: "workspace", clientId: "tool", capabilities: ["course.content.read" as const]};
    expect(() => sessions.grant({...request, workspaceId: "other"})).toThrow("SCOPE");
    expect(() => sessions.grant({...request, capabilities: ["learning.answer.submit"]})).toThrow("CAPABILITY");
    const first = sessions.grant(request), second = sessions.grant(request);
    expect(sessions.authorize(first.token, "GET", "/api/course-sources/units/unit")?.ownerId).toBe("owner");
    expect(sessions.authorize(first.token, "POST", "/api/units/unit/complete")).toBeNull();
    expect(sessions.authorize(first.token, "GET", "/api/profile")).toBeNull();
    expect(sessions.authorize(first.token, "GET", "/api/course-sources/units/unit/assets/image")).toBeNull();
    sessions.release(first.sessionId);
    expect(sessions.activeCount).toBe(1);
    expect(sessions.resolve(first.token)).toBeNull();
    const restarted = new WorkspaceServiceSessions("workspace", "owner", randomUUID(), randomUUID());
    expect(restarted.resolve(second.token)).toBeNull();
    now += 1001;
    expect(sessions.activeCount).toBe(0);
  });
});
