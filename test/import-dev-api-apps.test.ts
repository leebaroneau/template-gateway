import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GatewayAccessStore } from "../src/access/store.js";

let tempDir: string;
let dbPath: string;
let manifestPath: string;

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: process.cwd(), stdio: "pipe" });
});

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-import-dev-api-apps-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
  manifestPath = path.join(tempDir, "manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      version: 1,
      apps: [
        { key: "quatra-ops", name: "Quatra Ops Sync", type: "service", owner: "quatra-ops", scopes: ["brands.read"] }
      ]
    })
  );
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function runImport(args: string[] = []) {
  return execFileSync("node", ["scripts/import-dev-api-apps.mjs", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, MANIFEST_PATH: manifestPath, GATEWAY_STORE_PATH: dbPath },
    encoding: "utf8"
  });
}

function readClients() {
  const store = new GatewayAccessStore(dbPath);
  try {
    return store.listApiClients();
  } finally {
    store.close();
  }
}

describe("scripts/import-dev-api-apps.mjs", () => {
  it("creates clients and prints issued secrets once", () => {
    const output = runImport();

    expect(output).toContain("CREATED");
    expect(output).toContain("COPY THESE NOW");
    expect(output).toMatch(/gw_live_/);
    const clients = readClients().filter((client) => client.owner === "dev-api:quatra-ops");
    expect(clients).toHaveLength(1);
    expect(clients[0].keys).toHaveLength(1);
  });

  it("is idempotent without rotate", () => {
    runImport();
    const output = runImport();

    expect(output).toContain("EXISTS");
    expect(output).not.toContain("COPY THESE NOW");
    expect(readClients().filter((client) => client.owner === "dev-api:quatra-ops")).toHaveLength(1);
  });

  it("issues a new active key when rotate is set", () => {
    runImport();
    const output = runImport(["--rotate"]);

    expect(output).toContain("ROTATED");
    expect(output).toMatch(/gw_live_/);
    expect(readClients().find((client) => client.owner === "dev-api:quatra-ops")?.keys).toHaveLength(2);
  });

  it("dry-runs without writing clients", () => {
    const output = runImport(["--dry-run"]);

    expect(output).toContain("DRY RUN");
    expect(output).toContain("WOULD_CREATE");
    expect(readClients()).toHaveLength(0);
  });
});
