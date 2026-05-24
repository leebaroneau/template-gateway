#!/usr/bin/env node
// composio-create-servers.mjs
//
// Create N Composio Hosted MCP servers from N allowlist JSONs, with toolkit
// entity scope honoured per allowlist (per-profile vs shared brand entity).
// Output: a YAML fragment ready to paste into a brand's Hermes overlay.
//
// Usage:
//   COMPOSIO_API_KEY=ak_... node scripts/composio-create-servers.mjs \
//     --brand <brand-slug> \
//     --allowlists allowlists/outlook-mail-calendar.json,allowlists/ga4-reporting.json \
//     --auth-configs '{"outlook":"ac_abc","google_analytics":"ac_def"}' \
//     [--output ./<brand>-composio.yaml] \
//     [--mcp-base-url https://backend.composio.dev/v3/mcp] \
//     [--dry-run]
//
// Notes:
// - Reads `entity_scope` from each allowlist JSON: "per_profile" or "shared".
//   Per-profile → URL uses $${COMPOSIO_USER_ID} placeholder.
//   Shared      → URL hardcodes user_id=<brand-slug>.
// - Idempotent: if an MCP server named "<brand>-<toolkit>" already exists,
//   the script will recreate it (delete + create) so allowedTools is refreshed.
//   (Composio's mcp.update does not reliably persist allowedTools at this SDK
//   version — see template-gateway#6 and the spec for the back-story.)
// - The output YAML is brand-namespaced. Each toolkit becomes a server entry
//   keyed `composio-<short>` (e.g. `composio-outlook`, `composio-ga4`).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import minimist from "minimist";
import { Composio } from "@composio/core";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const args = minimist(process.argv.slice(2), {
  string: ["brand", "allowlists", "auth-configs", "output", "mcp-base-url"],
  boolean: ["dry-run"],
  default: { "mcp-base-url": "https://backend.composio.dev/v3/mcp" }
});

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

if (!process.env.COMPOSIO_API_KEY) fail("COMPOSIO_API_KEY is required (set it in env or .env)");
if (!args.brand) fail("--brand <slug> is required");
if (!args.allowlists) fail("--allowlists <path1>,<path2>,... is required");
if (!args["auth-configs"]) fail('--auth-configs \'{"<toolkit>":"ac_xxx",...}\' is required');

const BRAND = String(args.brand).trim();
const MCP_BASE_URL = String(args["mcp-base-url"]).replace(/\/$/, "");
const DRY_RUN = Boolean(args["dry-run"]);

let authConfigs;
try {
  authConfigs = JSON.parse(args["auth-configs"]);
  if (typeof authConfigs !== "object" || Array.isArray(authConfigs)) throw new Error("must be an object");
} catch (e) {
  fail(`--auth-configs must be valid JSON object (got: ${e.message})`);
}

const allowlistPaths = String(args.allowlists)
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => (p.startsWith("/") ? p : resolve(process.cwd(), p)));

const allowlists = allowlistPaths.map((path) => {
  if (!existsSync(path)) fail(`allowlist not found: ${path}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`allowlist ${path} is not valid JSON: ${e.message}`);
  }
  for (const required of ["toolkit", "entity_scope", "tools"]) {
    if (!parsed[required]) fail(`allowlist ${path} missing required field: ${required}`);
  }
  if (!["per_profile", "shared"].includes(parsed.entity_scope)) {
    fail(`allowlist ${path} entity_scope must be "per_profile" or "shared" (got ${parsed.entity_scope})`);
  }
  if (!authConfigs[parsed.toolkit]) {
    fail(`--auth-configs missing entry for toolkit "${parsed.toolkit}"`);
  }
  return { ...parsed, _path: path };
});

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
const overlay_entries = [];

for (const allowlist of allowlists) {
  const serverName = `${BRAND}-${shortNameFor(allowlist.toolkit)}`;
  const authConfigId = authConfigs[allowlist.toolkit];

  console.log(`\n=== ${serverName} (${allowlist.toolkit}) ===`);
  console.log(`  scope:        ${allowlist.entity_scope}`);
  console.log(`  authConfig:   ${authConfigId}`);
  console.log(`  allowedTools: ${allowlist.tools.length}`);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] skipping MCP server create`);
    continue;
  }

  const existing = await findExistingServer(composio, serverName);
  if (existing) {
    console.log(`  existing server ${existing.id} → deleting (allowlist refresh)`);
    await composio.mcp.delete(existing.id);
  }

  const server = await composio.mcp.create(serverName, {
    toolkits: [{ toolkit: allowlist.toolkit, authConfigId }],
    allowedTools: allowlist.tools,
    manuallyManageConnections: false
  });

  console.log(`  created:      ${server.id}`);

  overlay_entries.push(renderOverlayEntry({
    toolkit: allowlist.toolkit,
    entity_scope: allowlist.entity_scope,
    server_id: server.id,
    brand: BRAND,
    mcp_base_url: MCP_BASE_URL
  }));
}

if (DRY_RUN) {
  console.log("\n[DRY RUN] no overlay written. Re-run without --dry-run to commit.");
  process.exit(0);
}

const overlay = renderOverlayDocument(BRAND, overlay_entries);
const outputPath = args.output
  ? resolve(process.cwd(), args.output)
  : resolve(process.cwd(), `${BRAND}-composio.yaml`);
writeFileSync(outputPath, overlay, "utf8");
console.log(`\n✓ Overlay fragment written to ${outputPath}`);
console.log(`  Next: copy this into your brand deploy repo's Hermes overlay.`);
console.log(`  See docs/adding-a-brand.md for the per-profile env sync step.`);

// ---------- helpers ----------

function shortNameFor(toolkit) {
  // Map toolkit slug → MCP server short name suffix.
  const map = {
    outlook: "outlook",
    one_drive: "onedrive",
    pipedrive: "pipedrive",
    google_analytics: "ga4",
    google_search_console: "gsc",
    microsoft_clarity: "clarity",
    microsoft_teams: "teams"
  };
  return map[toolkit] ?? toolkit.replace(/_/g, "-");
}

async function findExistingServer(composio, name) {
  const list = await composio.mcp.list({ name, limit: 50 });
  const items = list?.items ?? list?.data ?? [];
  return items.find((s) => s.name === name);
}

function renderOverlayEntry({ toolkit, entity_scope, server_id, brand, mcp_base_url }) {
  const key = `composio-${shortNameFor(toolkit)}`;
  const user_id_segment = entity_scope === "shared" ? brand : "${COMPOSIO_USER_ID}";
  return [
    `  ${key}:`,
    `    url: ${mcp_base_url}/${server_id}/mcp?include_composio_helper_actions=true&user_id=${user_id_segment}`,
    `    headers:`,
    `      x-api-key: \${COMPOSIO_API_KEY}`,
    `    timeout: 120`
  ].join("\n");
}

function renderOverlayDocument(brand, entries) {
  return [
    `# ${brand} Composio MCP overlay fragment — generated by template-gateway`,
    `# composio-create-servers.mjs on ${new Date().toISOString()}.`,
    `#`,
    `# Paste these mcp_servers entries into your brand's Hermes overlay alongside`,
    `# any other servers (paperclip, custom brand MCP, etc.).`,
    `#`,
    `# Runtime substitution by Hermes:`,
    `#   \${COMPOSIO_USER_ID} → per-profile entity, written by runtime-seed`,
    `#   \${COMPOSIO_API_KEY} → org key, written by runtime-seed`,
    `#`,
    `# See docs/adding-a-brand.md for the per-profile env sync.`,
    ``,
    `mcp_servers:`,
    entries.join("\n\n"),
    ``
  ].join("\n");
}
