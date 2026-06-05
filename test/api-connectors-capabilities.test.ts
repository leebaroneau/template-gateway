import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayAccessStore } from "../src/access/store.js";
import type { GatewayApiScope } from "../src/access/types.js";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";
import { createGatewayApiRouter } from "../src/api/routes.js";
import { ComposioConnectorAdapter } from "../src/connectors/composio.js";
import { NangoConnectorAdapter } from "../src/connectors/nango.js";
import { ConnectorAdapterRegistry } from "../src/connectors/registry.js";

const stores: GatewayAccessStore[] = [];
const tempDirs: string[] = [];

function tempStorePath(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-caps-test-"));
  tempDirs.push(tempDir);
  return path.join(tempDir, "gateway.sqlite");
}

function openStore(): GatewayAccessStore {
  const store = new GatewayAccessStore(tempStorePath());
  stores.push(store);
  return store;
}

function createApiCredential(store: GatewayAccessStore, scopes: GatewayApiScope[] = ["connectors.read"]) {
  const client = store.createClient(
    { name: "Test Client", type: "service", owner: "test-owner", scopes },
    "test-admin"
  );
  const created = store.createKey(client.id, { label: "primary" }, "test-admin");
  return { client, key: created.key, secret: created.secret };
}

function buildRegistry({ composioApiKey, nangoSecretKey }: { composioApiKey?: string; nangoSecretKey?: string } = {}) {
  const registry = new ConnectorAdapterRegistry();
  registry.register(new ComposioConnectorAdapter({ apiKey: composioApiKey ?? "test-composio-key" }));
  registry.register(new NangoConnectorAdapter({ secretKey: nangoSecretKey }));
  return registry;
}

function appWithRegistry(store: GatewayAccessStore, registry: ConnectorAdapterRegistry) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    "/api/v1",
    createGatewayApiRouter({
      backend: new FixtureGatewayBackend(),
      accessStore: store,
      connectorRegistry: registry
    })
  );
  return app;
}

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
  }
});

describe("GET /connectors/:slug/capabilities", () => {
  it("returns 200 with capabilities for a Composio-backed connector (pipedrive)", async () => {
    const store = openStore();
    const { secret } = createApiCredential(store);
    const registry = buildRegistry({ composioApiKey: "real-key" });
    const app = appWithRegistry(store, registry);

    const res = await request(app)
      .get("/api/v1/connectors/pipedrive/capabilities")
      .set("Authorization", `Bearer ${secret}`);

    expect(res.status).toBe(200);
    expect(res.body.connectorSlug).toBe("pipedrive");
    expect(res.body.adapter).toMatchObject({
      slug: "composio",
      backendType: "composio",
      status: "available"
    });
    expect(res.body.capabilities).toHaveLength(3);
    expect(res.body.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "contacts.read", mode: "read" }),
        expect.objectContaining({ slug: "deals.read", mode: "read" }),
        expect.objectContaining({ slug: "activities.read", mode: "read" })
      ])
    );
  });

  it("returns 200 with empty capabilities and unconfigured status when Nango has no secretKey", async () => {
    const store = openStore();
    const { secret } = createApiCredential(store);
    // No secretKey → Nango is unconfigured
    const registry = buildRegistry({ nangoSecretKey: undefined });
    const app = appWithRegistry(store, registry);

    const res = await request(app)
      .get("/api/v1/connectors/google-search-console/capabilities")
      .set("Authorization", `Bearer ${secret}`);

    expect(res.status).toBe(200);
    expect(res.body.connectorSlug).toBe("google-search-console");
    expect(res.body.adapter).toMatchObject({
      slug: "nango",
      backendType: "nango",
      status: "unconfigured"
    });
    expect(res.body.capabilities).toEqual([]);
  });

  it("returns 404 for a connector slug with no registered adapter", async () => {
    const store = openStore();
    const { secret } = createApiCredential(store);
    const registry = buildRegistry();
    const app = appWithRegistry(store, registry);

    const res = await request(app)
      .get("/api/v1/connectors/unknown/capabilities")
      .set("Authorization", `Bearer ${secret}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "not_found", message: "No adapter registered for connector: unknown" }
    });
  });

  it("returns 401 when no auth token is provided", async () => {
    const store = openStore();
    const registry = buildRegistry();
    const app = appWithRegistry(store, registry);

    const res = await request(app).get("/api/v1/connectors/pipedrive/capabilities");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: "unauthorized", message: "Missing bearer token" }
    });
  });
});
