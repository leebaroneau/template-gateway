import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GatewayConnectionContext } from "../src/access/connection-tokens.js";
import { GatewayAccessStore } from "../src/access/store.js";
import { createInitialGatewayState } from "../src/admin/fixtures.js";
import { authenticateGatewayConnectionMcpRequest } from "../src/mcp-v1/connection-auth.js";

let tempDir: string;
let store: GatewayAccessStore;

const context: GatewayConnectionContext = {
  connectionId: "connection_haverford_au_shopify",
  brandId: "brand_haverford",
  regionId: "region_haverford_au",
  connectorSlug: "shopify"
};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-connection-auth-"));
  store = new GatewayAccessStore(path.join(tempDir, "gateway.sqlite"));
});

afterEach(() => {
  store.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("authenticateGatewayConnectionMcpRequest", () => {
  it("authenticates a valid bearer as a connection token actor", () => {
    const minted = store.mintConnectionToken({ connectionId: context.connectionId, context, label: "agent", actor: "test" });

    const result = authenticateGatewayConnectionMcpRequest({
      connectionId: context.connectionId,
      authorizationHeader: `Bearer ${minted.secret}`,
      identityHeaders: {},
      accessStore: store,
      state: createInitialGatewayState()
    });

    expect(result).toMatchObject({
      ok: true,
      actor: {
        type: "connection_token",
        context,
        scopes: ["mcp.read"],
        tokenId: minted.token.id
      }
    });
  });

  it("rejects a bearer bound to a different connection", () => {
    const minted = store.mintConnectionToken({ connectionId: context.connectionId, context, label: "agent", actor: "test" });

    const result = authenticateGatewayConnectionMcpRequest({
      connectionId: "connection_catnets_au_klaviyo",
      authorizationHeader: `Bearer ${minted.secret}`,
      identityHeaders: {},
      accessStore: store,
      state: createInitialGatewayState()
    });

    expect(result).toMatchObject({ ok: false, statusCode: 401 });
  });

  it("returns not_found and connection_unavailable before admitting a caller", () => {
    const state = createInitialGatewayState();
    expect(
      authenticateGatewayConnectionMcpRequest({
        connectionId: "missing",
        identityHeaders: { "x-auth-gate-email": "lee@haverford.au" },
        accessStore: store,
        state,
        authGateAllowedDomains: ["haverford.au"]
      })
    ).toMatchObject({ ok: false, statusCode: 404, reason: "not_found" });

    expect(
      authenticateGatewayConnectionMcpRequest({
        connectionId: "connection_haverford_au_outlook",
        identityHeaders: { "x-auth-gate-email": "lee@haverford.au" },
        accessStore: store,
        state,
        authGateAllowedDomains: ["haverford.au"]
      })
    ).toMatchObject({ ok: false, statusCode: 403, reason: "connection_unavailable" });
  });

  it("allows auth-gate email only when allowlisted and keeps path context", () => {
    const allowed = authenticateGatewayConnectionMcpRequest({
      connectionId: context.connectionId,
      identityHeaders: { "x-auth-gate-email": "Lee@Haverford.au", "x-user-email": "attacker@example.com" },
      accessStore: store,
      state: createInitialGatewayState(),
      authGateAllowedDomains: ["haverford.au"]
    });
    expect(allowed).toMatchObject({
      ok: true,
      actor: { type: "auth_gate", email: "lee@haverford.au", context }
    });

    const denied = authenticateGatewayConnectionMcpRequest({
      connectionId: context.connectionId,
      identityHeaders: { "x-auth-gate-email": "lee@haverford.au" },
      accessStore: store,
      state: createInitialGatewayState()
    });
    expect(denied).toMatchObject({ ok: false, statusCode: 401 });
  });
});
