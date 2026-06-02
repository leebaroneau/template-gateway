import "dotenv/config";

export type AdminDataSource = "fixture" | "dev-api";

export interface GatewayConfig {
  composioApiKey: string;
  composioProjectId?: string;
  brandSlug: string;
  gatewayBearer: string;
  toolkitAllowlist?: string[];
  authConfigs?: Record<string, string>;
  port: number;
  sessionTtlSeconds: number;
  adminDataSource: AdminDataSource;
  haverfordDevApiBaseUrl?: string;
  haverfordDevApiClientId?: string;
  haverfordDevApiClientSecret?: string;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function optionalEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
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

function parseAdminDataSource(raw?: string): AdminDataSource {
  if (!raw) return "fixture";
  const value = raw.trim().toLowerCase();
  if (value === "fixture" || value === "dev-api") {
    return value;
  }
  throw new Error(`ADMIN_DATA_SOURCE must be fixture or dev-api (got ${raw})`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return {
    composioApiKey: requireEnv(env, "COMPOSIO_API_KEY"),
    composioProjectId: optionalEnv(env, "COMPOSIO_PROJECT_ID"),
    brandSlug: requireEnv(env, "BRAND_SLUG"),
    gatewayBearer: requireEnv(env, "GATEWAY_BEARER"),
    toolkitAllowlist: parseToolkitAllowlist(env.TOOLKIT_ALLOWLIST),
    authConfigs: parseAuthConfigs(env.AUTH_CONFIGS),
    port: parsePort(env.PORT),
    sessionTtlSeconds: parseSessionTtl(env.SESSION_TTL_SECONDS),
    adminDataSource: parseAdminDataSource(env.ADMIN_DATA_SOURCE),
    haverfordDevApiBaseUrl: optionalEnv(env, "HAVERFORD_DEV_API_BASE_URL"),
    haverfordDevApiClientId: optionalEnv(env, "HAVERFORD_DEV_API_CLIENT_ID"),
    haverfordDevApiClientSecret: optionalEnv(env, "HAVERFORD_DEV_API_CLIENT_SECRET")
  };
}
