import { workspaceServiceDiscoverySchema, workspaceServiceSessionRequestSchema } from "./workspace-service.js";
it("rejects credential-bearing discovery and incompatible handshakes", () => {
  const discovery = {protocolVersion: 1, coreContractVersion: "course-source.v1", workspaceId: "workspace",
    instanceId: "28c0d21e-0484-4630-9545-289c3f63cd8d", epoch: "8407f732-930f-4d93-b708-398177b1b27e", pid: 100,
    endpoint: "http://127.0.0.1:4321", capabilities: ["course.content.read"], startedAt: "2026-10-08T04:00:00.000Z"};
  expect(workspaceServiceDiscoverySchema.parse(discovery)).toEqual(discovery);
  expect(workspaceServiceDiscoverySchema.safeParse({...discovery, token: "secret"}).success).toBe(false);
  expect(workspaceServiceDiscoverySchema.safeParse({...discovery, endpoint: "http://example.com:4321"}).success).toBe(false);
  expect(workspaceServiceSessionRequestSchema.safeParse({protocolVersion: 2, workspaceId: "workspace", clientId: "tool", capabilities: ["course.content.read"]}).success).toBe(false);
});
