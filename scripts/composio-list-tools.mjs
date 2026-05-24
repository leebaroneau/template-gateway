#!/usr/bin/env node
// composio-list-tools.mjs
//
// Probe a Composio toolkit and print its full tool catalog.
// Useful when choosing which tools to put in an allowlist JSON.
//
// Usage:
//   COMPOSIO_API_KEY=ak_... node scripts/composio-list-tools.mjs --toolkit outlook
//   COMPOSIO_API_KEY=ak_... node scripts/composio-list-tools.mjs --toolkit outlook,one_drive,pipedrive
//
// Env:
//   COMPOSIO_API_KEY  Required. Your org API key.

import minimist from "minimist";
import { Composio } from "@composio/core";
import "dotenv/config";

const args = minimist(process.argv.slice(2));

if (!process.env.COMPOSIO_API_KEY) {
  console.error("ERROR: COMPOSIO_API_KEY is required (set it in env or .env)");
  process.exit(1);
}

if (!args.toolkit) {
  console.error("ERROR: --toolkit <slug>[,<slug2>...] is required");
  console.error("Example: --toolkit outlook,one_drive");
  process.exit(1);
}

const toolkits = String(args.toolkit).split(",").map((s) => s.trim()).filter(Boolean);
const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 500;

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });

for (const slug of toolkits) {
  try {
    const result = await composio.tools.getRawComposioTools({ toolkits: [slug], limit });
    const items = Array.isArray(result) ? result : (result?.items ?? result?.data ?? []);
    console.log(`\n=== ${slug} (${items.length} tools) ===`);
    for (const tool of items) {
      const name = tool.slug || tool.name || tool.id || "<unknown>";
      console.log(`  ${name}`);
    }
  } catch (err) {
    console.error(`\n=== ${slug}: ERROR ===`);
    console.error(`  ${err.message}`);
  }
}
