import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccessStoreError, GatewayAccessStore } from "../src/access/store.js";
import type { GatewayConnectionContext } from "../src/access/connection-tokens.js";

let tempDir: string;
let store: GatewayAccessStore;

const context: GatewayConnectionContext = {
  connectionId: "connection_haverford_au_shopify",
  brandId: "brand_haverford",
  regionId: "region_haverford_au",
  connectorSlug: "shopify"
};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-connection-tokens-"));
  store = new GatewayAccessStore(path.join(tempDir, "gateway.sqlite"));
});

afterEach(() => {
  store.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("GatewayAccessStore connection tokens", () => {
  it("mints, lists, authenticates, rotates, and revokes a connection token", () => {
    const minted = store.mintConnectionToken({
      connectionId: context.connectionId,
      context,
      label: "agent",
      actor: "test-admin",
      mcpConnectionBaseUrl: "https://Gateway.Haverford.au"
    });

    expect(minted.secret).toMatch(/^gw_live_/);
    expect(minted.token).toMatchObject({
      id: expect.stringMatching(/^conntok_/),
      connectionId: context.connectionId,
      connectorSlug: "shopify",
      label: "agent",
      status: "active"
    });
    expect(minted.mcpUrl).toBe("https://Gateway.Haverford.au/mcp/v1/connections/connection_haverford_au_shopify");

    const authenticated = store.authenticateConnectionToken(context.connectionId, minted.secret);
    expect(authenticated?.record.id).toBe(minted.token.id);
    expect(authenticated?.client).toMatchObject({
      owner: `connection:${context.connectionId}`,
      scopes: ["mcp.read"]
    });
    expect(store.authenticateConnectionToken("connection_catnets_au_klaviyo", minted.secret)).toBeUndefined();
    expect(JSON.stringify(store.listConnectionTokens(context.connectionId))).not.toContain(minted.secret);

    const rotated = store.rotateConnectionToken(context.connectionId, minted.token.id, "test-admin");
    expect(rotated.token.id).toBe(minted.token.id);
    expect(rotated.secret).not.toBe(minted.secret);
    expect(store.authenticateConnectionToken(context.connectionId, minted.secret)).toBeUndefined();
    expect(store.authenticateConnectionToken(context.connectionId, rotated.secret)?.record.id).toBe(minted.token.id);

    const revoked = store.revokeConnectionToken(context.connectionId, minted.token.id, "test-admin");
    expect(revoked.status).toBe("revoked");
    expect(store.authenticateConnectionToken(context.connectionId, rotated.secret)).toBeUndefined();
    expect(store.revokeConnectionToken(context.connectionId, minted.token.id, "test-admin").status).toBe("revoked");
  });

  it("enforces active label uniqueness per connection and allows reuse after revoke", () => {
    const first = store.mintConnectionToken({ connectionId: context.connectionId, context, label: "agent", actor: "test-admin" });
    expect(() =>
      store.mintConnectionToken({ connectionId: context.connectionId, context, label: "agent", actor: "test-admin" })
    ).toThrowError(AccessStoreError);

    store.revokeConnectionToken(context.connectionId, first.token.id, "test-admin");
    const replacement = store.mintConnectionToken({
      connectionId: context.connectionId,
      context,
      label: "agent",
      actor: "test-admin"
    });
    expect(replacement.token.label).toBe("agent");
  });
});
