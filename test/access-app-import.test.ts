import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeImportApps, validateAppImportManifest } from "../src/access/app-import.js";

describe("dev api app import manifest", () => {
  it("accepts the committed example manifest", () => {
    const manifestPath = path.join(process.cwd(), "config/dev-api-apps.manifest.example.json");
    const manifest = validateAppImportManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));

    expect(manifest.version).toBe(1);
    expect(manifest.apps[0]).toMatchObject({ key: "quatra-ops", type: "service" });
  });

  it.each([
    [{ version: 1, apps: [{ key: "app", name: "App", type: "service", owner: "app", scopes: ["apps.delete"] }] }, "Unknown API scope: apps.delete"],
    [{ version: 1, apps: [{ key: "app", type: "service", owner: "app", scopes: ["brands.read"] }] }, "apps[0].name must be a non-empty string"],
    [{ version: 1, apps: [{ key: "app", name: "App", type: "robot", owner: "app", scopes: ["brands.read"] }] }, "apps[0].type must be one of: service, agent, worker"],
    [{ version: 1, apps: [
      { key: "app", name: "App", type: "service", owner: "app", scopes: ["brands.read"] },
      { key: "app", name: "App 2", type: "worker", owner: "app-2", scopes: ["brands.read"] }
    ] }, "Duplicate app key: app"],
    [{ version: 1, apps: {} }, "apps must be an array"]
  ])("rejects invalid manifest input", (input, message) => {
    expect(() => validateAppImportManifest(input)).toThrow(message);
  });

  it("normalizes imported apps with provenance owners and dated key labels", () => {
    const manifest = validateAppImportManifest({
      version: 1,
      apps: [
        {
          key: "quatra-ops",
          name: "Quatra Ops Sync",
          type: "service",
          owner: "quatra-ops",
          scopes: ["connections.read", "brands.read", "brands.read"]
        }
      ]
    });

    expect(normalizeImportApps(manifest, "2026-06-05")).toEqual([
      {
        manifestKey: "quatra-ops",
        client: {
          name: "Quatra Ops Sync",
          type: "service",
          owner: "dev-api:quatra-ops",
          scopes: ["connections.read", "brands.read"]
        },
        keyLabel: "dev-api-import-2026-06-05"
      }
    ]);
  });
});
