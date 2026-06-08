import { validateGatewayApiScopes, type CreateApiClientInput } from "./types.js";

const CLIENT_TYPES = ["service", "agent", "worker"] as const;
const DEFAULT_KEY_LABEL_PREFIX = "dev-api-import";

export interface DevApiAppManifestEntry {
  key: string;
  name: string;
  type: CreateApiClientInput["type"];
  owner: string;
  scopes: string[];
  notes?: string;
}

export interface DevApiAppManifest {
  version: 1;
  issuedKeyLabelPrefix?: string;
  apps: DevApiAppManifestEntry[];
}

export interface NormalizedImportApp {
  manifestKey: string;
  client: CreateApiClientInput;
  keyLabel: string;
}

export function validateAppImportManifest(value: unknown): DevApiAppManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("manifest must be an object");
  }

  const manifest = value as Record<string, unknown>;
  if (manifest.version !== undefined && manifest.version !== 1) {
    throw new Error("version must be 1");
  }
  if (manifest.issuedKeyLabelPrefix !== undefined && !isNonEmptyString(manifest.issuedKeyLabelPrefix)) {
    throw new Error("issuedKeyLabelPrefix must be a non-empty string");
  }
  if (!Array.isArray(manifest.apps)) {
    throw new Error("apps must be an array");
  }

  const seenKeys = new Set<string>();
  const apps = manifest.apps.map((entry, index) => validateEntry(entry, index, seenKeys));
  return {
    version: 1,
    issuedKeyLabelPrefix: manifest.issuedKeyLabelPrefix as string | undefined,
    apps
  };
}

export function normalizeImportApps(manifest: DevApiAppManifest, today: string): NormalizedImportApp[] {
  const prefix = manifest.issuedKeyLabelPrefix ?? DEFAULT_KEY_LABEL_PREFIX;
  return manifest.apps.map((app) => ({
    manifestKey: app.key,
    client: {
      name: app.name,
      type: app.type,
      owner: `dev-api:${app.owner}`,
      scopes: validateGatewayApiScopes(app.scopes)
    },
    keyLabel: `${prefix}-${today}`
  }));
}

function validateEntry(value: unknown, index: number, seenKeys: Set<string>): DevApiAppManifestEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`apps[${index}] must be an object`);
  }
  const entry = value as Record<string, unknown>;
  const key = requireString(entry.key, `apps[${index}].key`);
  if (seenKeys.has(key)) {
    throw new Error(`Duplicate app key: ${key}`);
  }
  seenKeys.add(key);

  const type = entry.type;
  if (typeof type !== "string" || !(CLIENT_TYPES as readonly string[]).includes(type)) {
    throw new Error(`apps[${index}].type must be one of: service, agent, worker`);
  }

  const app: DevApiAppManifestEntry = {
    key,
    name: requireString(entry.name, `apps[${index}].name`),
    type: type as CreateApiClientInput["type"],
    owner: requireString(entry.owner, `apps[${index}].owner`),
    scopes: validateGatewayApiScopes(entry.scopes)
  };
  if (entry.notes !== undefined) {
    app.notes = requireString(entry.notes, `apps[${index}].notes`);
  }
  return app;
}

function requireString(value: unknown, label: string): string {
  if (!isNonEmptyString(value)) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
