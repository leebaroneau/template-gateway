import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayAccessStore } from "../src/access/store.js";

let tempDir: string;
let store: GatewayAccessStore;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-access-import-owner-"));
  store = new GatewayAccessStore(path.join(tempDir, "gateway.sqlite"));
});

afterEach(() => {
  store.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("GatewayAccessStore imported app provenance", () => {
  it("keeps dev api provenance in the owner field only", () => {
    const imported = store.createClient(
      { name: "Quatra Ops Sync", type: "service", owner: "dev-api:quatra-ops", scopes: ["brands.read"] },
      "dev-api-importer"
    );
    store.createClient(
      { name: "Unrelated", type: "service", owner: "ops@haverford.au", scopes: ["brands.read"] },
      "local-admin"
    );

    const matches = store.listApiClients().filter((client) => client.owner === "dev-api:quatra-ops");

    expect(imported.id).toMatch(/^api_client_/);
    expect(matches).toEqual([expect.objectContaining({ id: imported.id, owner: "dev-api:quatra-ops" })]);
    expect(store.listAuditEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "api_client.created",
          targetId: imported.id,
          metadata: { owner: "dev-api:quatra-ops", type: "service" }
        })
      ])
    );
  });

  it("does not write issued secrets to audit metadata", () => {
    const client = store.createClient(
      { name: "Quatra Ops Sync", type: "service", owner: "dev-api:quatra-ops", scopes: ["brands.read"] },
      "dev-api-importer"
    );
    const issued = store.createKey(client.id, { label: "dev-api-import-2026-06-05" }, "dev-api-importer");

    expect(JSON.stringify(store.listAuditEvents())).not.toContain(issued.secret);
    expect(store.listAuditEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "api_key.created",
          metadata: { clientId: client.id, label: "dev-api-import-2026-06-05" }
        })
      ])
    );
  });
});
