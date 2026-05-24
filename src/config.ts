import "dotenv/config";

export interface GatewayConfig {
  composioApiKey: string;
  composioProjectId?: string;
  brandSlug: string;
  gatewayBearer: string;
  toolkitAllowlist?: string[];
  authConfigs?: Record<string, string>;
  port: number;
  sessionTtlSeconds: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value.trim() === "") return undefined;
  return value.trim();
}

function parseToolkitAllowlist(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function parsePort(raw?: string): number {
  if (!raw) return 3000;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return n;
}

function parseAuthConfigs(raw?: string): Record<string, string> | undefined {
  if (!raw) return undefined;
  const map: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const [toolkit, authConfigId] = trimmed.split(":").map((s) => s.trim());
    if (!toolkit || !authConfigId) {
      throw new Error(
        `AUTH_CONFIGS entry "${trimmed}" must be in the form toolkit:ac_xxx`
      );
    }
    map[toolkit.toLowerCase()] = authConfigId;
  }
  return Object.keys(map).length === 0 ? undefined : map;
}

function parseSessionTtl(raw?: string): number {
  if (!raw) return 3600;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 60) {
    throw new Error(`SESSION_TTL_SECONDS must be at least 60 (got ${raw})`);
  }
  return Math.floor(n);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return {
    composioApiKey: requireEnv("COMPOSIO_API_KEY"),
    composioProjectId: optionalEnv("COMPOSIO_PROJECT_ID"),
    brandSlug: requireEnv("BRAND_SLUG"),
    gatewayBearer: requireEnv("GATEWAY_BEARER"),
    toolkitAllowlist: parseToolkitAllowlist(env.TOOLKIT_ALLOWLIST),
    authConfigs: parseAuthConfigs(env.AUTH_CONFIGS),
    port: parsePort(env.PORT),
    sessionTtlSeconds: parseSessionTtl(env.SESSION_TTL_SECONDS)
  };
}
