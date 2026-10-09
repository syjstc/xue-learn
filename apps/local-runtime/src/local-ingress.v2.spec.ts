import type { NextFunction, Request, Response } from "express";
import { LOCAL_OWNER_ID } from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";
import { WorkspaceServiceSessions } from "./workspace-service-sessions.ts";
import { createLocalIngressMiddleware } from "./local-ingress.ts";

function request(
  path: string,
  authorization?: string,
  method = "GET",
): Request {
  return {
    path,
    originalUrl: path,
    method,
    headers: {
      authorization,
      "x-user-id": "forged-user",
      "x-user-role": "forged-role",
    },
  } as unknown as Request;
}

function response() {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  return { response: { status } as unknown as Response, status, json };
}

describe("desktop-local ingress v2", () => {
  const token = "ab".repeat(32);

  it("rejects missing or invalid credentials", () => {
    const middleware = createLocalIngressMiddleware(token);
    const next = jest.fn() as unknown as NextFunction;
    const missing = response();

    middleware(request("/api/profile"), missing.response, next);

    expect(missing.status).toHaveBeenCalledWith(401);
    expect(missing.json).toHaveBeenCalledWith({
      statusCode: 401,
      message: "Invalid local session",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("sets the fixed owner and strips caller identity headers", () => {
    const middleware = createLocalIngressMiddleware(token);
    const req = request("/api/profile", `Bearer ${token}`);
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, response().response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.headers["x-user-id"]).toBe(LOCAL_OWNER_ID);
    expect(req.headers["x-user-role"]).toBe("local-runtime");
    expect(req.headers["x-user-roles"]).toBe("learner,local-administrator");
  });

  it("keeps forbidden hosted routes unavailable locally", () => {
    const middleware = createLocalIngressMiddleware(token);
    const result = response();

    middleware(request("/api/auth/register", `Bearer ${token}`), result.response, jest.fn());

    expect(result.status).toHaveBeenCalledWith(404);
    expect(result.json).toHaveBeenCalledWith({ statusCode: 404, message: "Not Found" });
  });

  it("blocks structural mutations when the device does not hold the sync lease", async () => {
    const middleware = createLocalIngressMiddleware(
      token,
      async () => false,
      async () => false,
    );
    const result = response();
    const next = jest.fn() as unknown as NextFunction;

    middleware(
      request(
        "/api/units/u1/sections/s1/generate/stream",
        `Bearer ${token}`,
        "POST",
      ),
      result.response,
      next,
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.status).toHaveBeenCalledWith(423);
    expect(result.json).toHaveBeenCalledWith({
      statusCode: 423,
      code: "PERSONAL_SYNC_LEASE_REQUIRED",
      message: "This change requires the current device to hold the sync lease",
    });
    expect(next).not.toHaveBeenCalled();
  });
});

it("a scoped course reader cannot inherit the host administrator or learning writes", () => {
  const sessions = new WorkspaceServiceSessions("workspace", "owner", "instance", "epoch");
  const granted = sessions.grant({protocolVersion: 1, workspaceId: "workspace", clientId: "reader", capabilities: ["course.content.read"]});
  const middleware = createLocalIngressMiddleware("host-token", undefined, undefined, sessions);
  const next = jest.fn() as unknown as NextFunction;
  const allowed = request("/api/course-sources/units/unit", `Bearer ${granted.token}`);
  middleware(allowed, response().response, next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(allowed.headers["x-user-roles"]).toBe("learner");
  expect(allowed.headers["x-workspace-session-id"]).toBe(granted.sessionId);
  for (const [method, path] of [["POST", "/api/units/unit/complete"], ["POST", "/api/workspace-service/sessions"], ["GET", "/api/profile"], ["DELETE", "/api/workspace-service/sessions/another"]]) {
    const rejected = response();
    middleware(request(path!, `Bearer ${granted.token}`, method), rejected.response, next);
    expect(rejected.status).toHaveBeenCalledWith(401);
  }
  expect(next).toHaveBeenCalledTimes(1);
});
it("allows scoped-session and owner drain controls while an incompatible synced workspace blocks learner edits", async () => {
 const sessions=new WorkspaceServiceSessions("workspace","owner","instance","epoch");
 const grant=sessions.grant({protocolVersion:1,workspaceId:"workspace",clientId:"reader",capabilities:["course.content.read"]});
 const middleware=createLocalIngressMiddleware("host",async()=>true,async()=>false,sessions);
 for(const [method,path,credential] of [
  ["POST","/api/workspace-service/drain","host"],
  ["POST","/api/workspace-service/resume","host"],
  ["POST","/api/workspace-service/sessions","host"],
  ["POST",`/api/workspace-service/sessions/${grant.sessionId}/renew`,grant.token],
  ["DELETE",`/api/workspace-service/sessions/${grant.sessionId}`,grant.token],
  ["POST","/api/local/personal-sync/runtime/disable","host"],
 ]) { const next=jest.fn(),result=response();middleware(request(path!,`Bearer ${credential}`,method),result.response,next);expect(next).toHaveBeenCalledTimes(1);expect(result.status).not.toHaveBeenCalled(); }
 const denied=response(),next=jest.fn();middleware(request("/api/units/unit/complete","Bearer host","POST"),denied.response,next);
 await new Promise(resolve=>setImmediate(resolve));expect(denied.status).toHaveBeenCalledWith(423);expect(next).not.toHaveBeenCalled();
});
