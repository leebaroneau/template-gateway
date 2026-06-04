import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdminBackendError, statusCodeForAdminError } from "../src/admin/backend-error.js";
import { AccessStoreError, GatewayAccessStore } from "../src/access/store.js";

let tempDir: string;
let dbPath: string;
let stores: GatewayAccessStore[];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-access-store-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
  stores = [];
});

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function openStore(pathname = dbPath): GatewayAccessStore {
  const store = new GatewayAccessStore(pathname);
  stores.push(store);
  return store;
}

function closeStore(store: GatewayAccessStore): void {
  store.close();
  stores = stores.filter((candidate) => candidate !== store);
}

function expectAccessStoreError(action: () => unknown, statusCode: number, message: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toBe(message);
  expect(thrown).toMatchObject({ statusCode });
}

describe("GatewayAccessStore", () => {
  it("creates clients and reveals key secrets only from key creation", () => {
    const store = openStore();
    const client = store.createClient(
      {
        name: "Dashboard App",
        type: "service",
        owner: "ops@haverford.au",
        scopes: ["audit.read", "brands.read"]
      },
      "local-admin"
    );
    const created = store.createKey(client.id, { label: "primary" }, "local-admin");

    expect(client.id).toMatch(/^api_client_/);
    expect(client.scopes).toEqual(["audit.read", "brands.read"]);
    expect(created.secret).toMatch(/^gw_live_[A-Za-z0-9_-]+$/);
    expect(created.key.id).toMatch(/^api_key_/);
    expect(created.key.preview).toBe(`gw_live_...${created.secret.slice(-4)}`);
    expect(created.key.fingerprint).toMatch(/^[a-f0-9]{16}$/);

    const listed = store.listApiClients();
    expect(listed).toHaveLength(1);
    expect(listed[0].keys).toHaveLength(1);
    expect(listed[0].keys[0]).not.toHaveProperty("secret");
    expect(JSON.stringify(listed)).not.toContain(created.secret);

    const authenticated = store.authenticate(created.secret);
    expect(authenticated?.client).toMatchObject({ id: client.id, name: "Dashboard App" });
    expect(authenticated?.key).toMatchObject({ id: created.key.id, label: "primary", status: "active" });
  });

  it("persists clients and active keys across store restart", () => {
    const firstStore = openStore();
    const client = firstStore.createClient(
      { name: "MCP Reader", type: "agent", owner: "mcp@haverford.au", scopes: ["connections.read"] },
      "local-admin"
    );
    const created = firstStore.createKey(client.id, { label: "reader" }, "local-admin");
    closeStore(firstStore);

    const secondStore = openStore();
    expect(secondStore.authenticate(created.secret)?.client.name).toBe("MCP Reader");
    expect(secondStore.listApiClients()).toEqual([
      expect.objectContaining({
        id: client.id,
        name: "MCP Reader",
        keys: [expect.objectContaining({ id: created.key.id, label: "reader", status: "active" })]
      })
    ]);
  });

  it("rotates a key in place and invalidates the old secret immediately", () => {
    const store = openStore();
    const client = store.createClient(
      { name: "Rotation Client", type: "worker", owner: "ops@haverford.au", scopes: ["brands.read"] },
      "local-admin"
    );
    const created = store.createKey(client.id, { label: "primary" }, "local-admin");
    const rotated = store.rotateKey(client.id, created.key.id, "local-admin");

    expect(rotated.key).toMatchObject({
      id: created.key.id,
      label: "primary",
      status: "active",
      createdAt: created.key.createdAt
    });
    expect(rotated.key.rotatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.key.preview).not.toBe(created.key.preview);
    expect(rotated.key.fingerprint).not.toBe(created.key.fingerprint);
    expect(store.authenticate(created.secret)).toBeUndefined();
    expect(store.authenticate(rotated.secret)?.key.id).toBe(created.key.id);
  });

  it("blocks revoked keys and revoked clients", () => {
    const store = openStore();
    const client = store.createClient(
      { name: "Revocation Client", type: "service", owner: "ops@haverford.au", scopes: ["brands.read"] },
      "local-admin"
    );
    const created = store.createKey(client.id, { label: "primary" }, "local-admin");

    const revokedKey = store.revokeKey(client.id, created.key.id, "local-admin");
    expect(revokedKey).toMatchObject({ id: created.key.id, status: "revoked", createdAt: created.key.createdAt });
    expect(revokedKey.revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(store.authenticate(created.secret)).toBeUndefined();

    const replacement = store.createKey(client.id, { label: "replacement" }, "local-admin");
    const revokedClient = store.updateClient(client.id, { status: "revoked" }, "local-admin");
    expect(revokedClient.status).toBe("revoked");
    expect(store.authenticate(replacement.secret)).toBeUndefined();
  });

  it("treats revoked clients as terminal and rejects new keys", () => {
    const store = openStore();
    const client = store.createClient(
      { name: "Terminal Client", type: "service", owner: "ops@haverford.au", scopes: ["brands.read"] },
      "local-admin"
    );
    const created = store.createKey(client.id, { label: "primary" }, "local-admin");

    store.updateClient(client.id, { status: "revoked" }, "local-admin");

    expectAccessStoreError(
      () => store.updateClient(client.id, { status: "active" }, "local-admin"),
      409,
      `API client is revoked: ${client.id}`
    );
    expect(store.listApiClients()[0].status).toBe("revoked");
    expect(store.authenticate(created.secret)).toBeUndefined();
    expectAccessStoreError(
      () => store.createKey(client.id, { label: "replacement" }, "local-admin"),
      409,
      `API client is revoked: ${client.id}`
    );
  });

  it("records usage metrics and access audit events without raw secrets", () => {
    const store = openStore();
    const client = store.createClient(
      { name: "Usage Client", type: "service", owner: "ops@haverford.au", scopes: ["brands.read"] },
      "local-admin"
    );
    const created = store.createKey(client.id, { label: "primary" }, "local-admin");

    store.recordUsage({
      clientId: client.id,
      keyId: created.key.id,
      route: "/api/v1/brands",
      method: "GET",
      statusCode: 200,
      scope: "brands.read",
      durationMs: 12
    });
    store.recordUsage({
      clientId: client.id,
      keyId: created.key.id,
      route: "/api/v1/brands",
      method: "GET",
      statusCode: 500,
      scope: "brands.read",
      durationMs: 20
    });
    store.writeAccessAudit({
      action: "api_read.succeeded",
      targetType: "api_client",
      targetId: client.id,
      detail: "Read /api/v1/brands",
      actor: client.id,
      metadata: { fingerprint: created.key.fingerprint, route: "/api/v1/brands", secret: created.secret }
    });

    const listed = store.listApiClients()[0];
    expect(listed.requestCount24h).toBe(2);
    expect(listed.errorRate24h).toBe(0.5);
    const auditJson = JSON.stringify(store.listAuditEvents());
    expect(auditJson).not.toContain(created.secret);
    expect(store.listAuditEvents()[0].metadata).toMatchObject({ secret: "[redacted]" });
  });

  it("redacts unsafe audit metadata keys and values", () => {
    const store = openStore();
    const client = store.createClient(
      { name: "Audit Client", type: "service", owner: "ops@haverford.au", scopes: ["audit.read"] },
      "local-admin"
    );
    const unsafeMetadata = {
      authorization: "Bearer bearer-token-value",
      api_key: "shpat_shopify-token",
      access_token: "ya29.google-token",
      token: "xoxb-slack-token",
      secret: "gw_live_testsecret",
      password: "plain-password",
      private_key: "-----BEGIN PRIVATE KEY-----abc",
      bearer: "Bearer abc",
      service_account_token: "sk_service-account",
      safeBearerValue: "Bearer still-redacted",
      safePemValue: "-----BEGIN RSA PRIVATE KEY-----abc",
      safeOpenAiValue: "sk_project-token",
      safeGatewayValue: "gw_live_abc123",
      safeShopifyValue: "shpat_abc123",
      safeGoogleValue: "ya29.token",
      safeSlackValue: "xoxp-token",
      safe: "visible"
    };

    store.writeAccessAudit({
      action: "api_read.succeeded",
      targetType: "api_client",
      targetId: client.id,
      detail: "Audit redaction smoke",
      actor: client.id,
      metadata: unsafeMetadata
    });

    const metadata = store.listAuditEvents()[0].metadata;
    expect(metadata).toEqual({
      authorization: "[redacted]",
      api_key: "[redacted]",
      access_token: "[redacted]",
      token: "[redacted]",
      secret: "[redacted]",
      password: "[redacted]",
      private_key: "[redacted]",
      bearer: "[redacted]",
      service_account_token: "[redacted]",
      safeBearerValue: "[redacted]",
      safePemValue: "[redacted]",
      safeOpenAiValue: "[redacted]",
      safeGatewayValue: "[redacted]",
      safeShopifyValue: "[redacted]",
      safeGoogleValue: "[redacted]",
      safeSlackValue: "[redacted]",
      safe: "visible"
    });
    expect(JSON.stringify(metadata)).not.toContain("Bearer ");
    expect(JSON.stringify(metadata)).not.toContain("ya29");
    expect(JSON.stringify(metadata)).not.toContain("shpat_");
    expect(JSON.stringify(metadata)).not.toContain("xox");
    expect(JSON.stringify(metadata)).not.toContain("sk_");
    expect(JSON.stringify(metadata)).not.toContain("gw_live_");
    expect(JSON.stringify(metadata)).not.toContain("PRIVATE KEY");
  });

  it("rejects unknown scopes with the exact validation message", () => {
    const store = openStore();

    try {
      store.createClient(
        { name: "Bad Scopes", type: "service", owner: "ops@haverford.au", scopes: ["bad.scope" as never] },
        "local-admin"
      );
      throw new Error("expected createClient to reject bad scope");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Unknown API scope: bad.scope");
    }
  });

  it("rejects duplicate active key labels under one client", () => {
    const store = openStore();
    const client = store.createClient(
      { name: "Duplicate Labels", type: "service", owner: "ops@haverford.au", scopes: ["brands.read"] },
      "local-admin"
    );
    store.createKey(client.id, { label: "primary" }, "local-admin");

    expect(() => store.createKey(client.id, { label: "primary" }, "local-admin")).toThrow(
      "API key label already exists for client: primary"
    );
    expect(() => store.createKey(client.id, { label: "primary" }, "local-admin")).toThrow(
      expect.objectContaining({ statusCode: 409 })
    );
  });

  it("validates client type and status inputs", () => {
    const store = openStore();
    const client = store.createClient(
      { name: "Validation Client", type: "service", owner: "ops@haverford.au", scopes: ["brands.read"] },
      "local-admin"
    );

    expectAccessStoreError(
      () =>
        store.createClient(
          { name: "Bad Type", type: "integration" as never, owner: "ops@haverford.au", scopes: ["brands.read"] },
          "local-admin"
        ),
      400,
      "Invalid API client type: integration"
    );
    expectAccessStoreError(
      () => store.updateClient(client.id, { type: "integration" as never }, "local-admin"),
      400,
      "Invalid API client type: integration"
    );
    expectAccessStoreError(
      () => store.updateClient(client.id, { status: "disabled" as never }, "local-admin"),
      400,
      "Invalid API client status: disabled"
    );
  });

  it("rejects invalid enum values found in stored rows", () => {
    const store = openStore();
    const client = store.createClient(
      { name: "Corrupt Client", type: "service", owner: "ops@haverford.au", scopes: ["brands.read"] },
      "local-admin"
    );
    const key = store.createKey(client.id, { label: "primary" }, "local-admin").key;
    closeStore(store);

    const db = new Database(dbPath);
    db.prepare("UPDATE gateway_api_clients SET type = 'integration' WHERE id = ?").run(client.id);
    db.close();
    const invalidTypeStore = openStore();
    expectAccessStoreError(() => invalidTypeStore.listApiClients(), 400, "Invalid API client type: integration");
    closeStore(invalidTypeStore);

    const statusDb = new Database(dbPath);
    statusDb.prepare("UPDATE gateway_api_clients SET type = 'service', status = 'disabled' WHERE id = ?").run(client.id);
    statusDb.close();
    const invalidStatusStore = openStore();
    expectAccessStoreError(() => invalidStatusStore.listApiClients(), 400, "Invalid API client status: disabled");
    closeStore(invalidStatusStore);

    const keyDb = new Database(dbPath);
    keyDb.prepare("UPDATE gateway_api_clients SET status = 'active' WHERE id = ?").run(client.id);
    keyDb.prepare("UPDATE gateway_api_keys SET status = 'disabled' WHERE id = ?").run(key.id);
    keyDb.close();
    const invalidKeyStatusStore = openStore();
    expectAccessStoreError(() => invalidKeyStatusStore.listApiClients(), 400, "Invalid API key status: disabled");
  });

  it("does not swallow database errors during authentication", () => {
    const store = openStore();
    const client = store.createClient(
      { name: "Closed Store Client", type: "service", owner: "ops@haverford.au", scopes: ["brands.read"] },
      "local-admin"
    );
    const created = store.createKey(client.id, { label: "primary" }, "local-admin");

    expect(store.authenticate(`${created.secret}x`)).toBeUndefined();
    closeStore(store);
    expect(() => store.authenticate(created.secret)).toThrow();
  });
});

describe("statusCodeForAdminError", () => {
  it("honors AdminBackendError and Error-like statusCode values", () => {
    expect(statusCodeForAdminError(new AdminBackendError(409, "conflict"))).toBe(409);
    expect(statusCodeForAdminError(new AccessStoreError(404, "missing"))).toBe(404);
    expect(statusCodeForAdminError(Object.assign(new Error("gateway"), { statusCode: 502 }))).toBe(502);
    expect(statusCodeForAdminError(Object.assign(new Error("bad"), { statusCode: "409" }))).toBe(400);
    expect(statusCodeForAdminError(Object.assign(new Error("low"), { statusCode: 399 }))).toBe(400);
    expect(statusCodeForAdminError(Object.assign(new Error("high"), { statusCode: 600 }))).toBe(400);
    expect(statusCodeForAdminError(Object.assign(new Error("float"), { statusCode: 409.5 }))).toBe(400);
  });
});
