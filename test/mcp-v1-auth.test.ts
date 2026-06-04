import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayAccessStore } from "../src/access/store.js";
import type { GatewayApiScope } from "../src/access/types.js";
import { authenticateGatewayMcpRequest, mcpAuthGateEmailFromHeaders } from "../src/mcp-v1/auth.js";

const stores: GatewayAccessStore[] = [];
const tempDirs: string[] = [];

function tempStore(): GatewayAccessStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-mcp-auth-"));
  tempDirs.push(dir);
  const store = new GatewayAccessStore(path.join(dir, "gateway.sqlite"));
  stores.push(store);
  return store;
}

function credential(store: GatewayAccessStore, scopes: GatewayApiScope[]) {
  const client = store.createClient({ name: "MCP Client", type: "agent", owner: "mcp@haverford.au", scopes }, "test");
  const created = store.createKey(client.id, { label: "primary" }, "test");
  return { client, key: created.key, secret: created.secret };
}

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
});

describe("MCP v1 auth", () => {
  it("extracts Auth Gate email headers in priority order", () => {
    expect(
      mcpAuthGateEmailFromHeaders({
        "x-user-email": "fallback@haverford.au",
        "x-forwarded-email": "forwarded@haverford.au",
        "x-auth-gate-email": "primary@haverford.au"
      })
    ).toBe("primary@haverford.au");
    expect(mcpAuthGateEmailFromHeaders({ "x-forwarded-email": " Forwarded@Haverford.au " })).toBe(
      "forwarded@haverford.au"
    );
  });

  it("authenticates gateway API keys with mcp.read", () => {
    const store = tempStore();
    const { client, secret } = credential(store, ["mcp.read"]);

    const result = authenticateGatewayMcpRequest({
      authorizationHeader: `Bearer ${secret}`,
      identityHeaders: {},
      accessStore: store,
      authGateAllowedDomains: undefined,
      authGateAllowedUsers: undefined
    });

    expect(result.ok).toBe(true);
    expect(result.actor).toMatchObject({ type: "api_client", actorId: client.id, scopes: ["mcp.read"] });
  });

  it("allows trusted Auth Gate users only when allowlists are configured", () => {
    const store = tempStore();
    const allowed = authenticateGatewayMcpRequest({
      authorizationHeader: undefined,
      identityHeaders: { "x-auth-gate-email": "Lee@Haverford.au" },
      accessStore: store,
      authGateAllowedDomains: ["haverford.au"],
      authGateAllowedUsers: []
    });
    const disabled = authenticateGatewayMcpRequest({
      authorizationHeader: undefined,
      identityHeaders: { "x-auth-gate-email": "lee@haverford.au" },
      accessStore: store,
      authGateAllowedDomains: undefined,
      authGateAllowedUsers: undefined
    });

    expect(allowed.ok).toBe(true);
    expect(allowed.actor).toMatchObject({
      type: "auth_gate",
      actorId: "lee@haverford.au",
      scopes: ["mcp.read"]
    });
    expect(disabled).toMatchObject({ ok: false, statusCode: 401, reason: "missing_or_invalid_auth" });
  });

  it("allows trusted Auth Gate users by exact email", () => {
    const store = tempStore();

    const allowed = authenticateGatewayMcpRequest({
      authorizationHeader: undefined,
      identityHeaders: { "x-auth-gate-email": "ops@external.example" },
      accessStore: store,
      authGateAllowedDomains: ["haverford.au"],
      authGateAllowedUsers: ["ops@external.example"]
    });

    expect(allowed.ok).toBe(true);
    expect(allowed.actor).toMatchObject({
      type: "auth_gate",
      actorId: "ops@external.example",
      scopes: ["mcp.read"]
    });
  });

  it("rejects invalid bearer keys even when a query token value exists elsewhere", () => {
    const store = tempStore();

    const result = authenticateGatewayMcpRequest({
      authorizationHeader: "Bearer gw_live_invalid",
      identityHeaders: {},
      accessStore: store,
      authGateAllowedDomains: undefined,
      authGateAllowedUsers: undefined
    });

    expect(result).toMatchObject({ ok: false, statusCode: 401, reason: "missing_or_invalid_auth" });
  });
});
