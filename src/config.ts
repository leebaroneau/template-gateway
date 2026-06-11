import "dotenv/config";
import type { GoogleOAuthConfig } from "./google-oauth/adapter.js";
import type { FacebookOAuthConfig } from "./facebook-oauth/adapter.js";
import type { PipedriveFacadeConfig } from "./pipedrive-facade.js";
import type { ShopifyOAuthConfig } from "./shopify-oauth/adapter.js";

export type AdminDataSource = "fixture" | "dev-api" | "fixture-overlay" | "dev-api-overlay" | "gateway-store";

export interface GatewayConfig {
  composioApiKey?: string;
  composioProjectId?: string;
  composioAdapterSlugs?: string[];
  nangoAdapterSlugs?: string[];
  brandSlug: string;
  gatewayBearer: string;
  toolkitAllowlist?: string[];
  authConfigs?: Record<string, string>;
  port: number;
  sessionTtlSeconds: number;
  adminDataSource: AdminDataSource;
  gatewayStorePath: string;
  haverfordDevApiBaseUrl?: string;
  haverfordDevApiClientId?: string;
  haverfordDevApiClientSecret?: string;
  mcpAuthGateAllowedDomains?: string[];
  mcpAuthGateAllowedUsers?: string[];
  mcpConnectionBaseUrl?: string;
  pipedriveFacade?: PipedriveFacadeConfig;
  googleOAuth?: GoogleOAuthConfig;
  shopifyOAuth?: ShopifyOAuthConfig;
  facebookOAuth?: FacebookOAuthConfig;
  googleAdsDevToken?: string;
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

function parseCommaList(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return values.length === 0 ? undefined : Array.from(new Set(values));
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

function parseBoolean(raw?: string, defaultValue = false): boolean {
  if (!raw) return defaultValue;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`Boolean env var must be true/false/1/0/yes/no/on/off (got ${raw})`);
}

function parseAdminDataSource(raw?: string): AdminDataSource {
  if (!raw) return "fixture";
  const value = raw.trim().toLowerCase();
  if (
    value === "fixture" ||
    value === "dev-api" ||
    value === "fixture-overlay" ||
    value === "dev-api-overlay" ||
    value === "gateway-store"
  ) {
    return value;
  }
  throw new Error(`ADMIN_DATA_SOURCE must be fixture, dev-api, fixture-overlay, dev-api-overlay, or gateway-store (got ${raw})`);
}

function parseGatewayStorePath(env: NodeJS.ProcessEnv, dataSource: AdminDataSource): string {
  const configured = optionalEnv(env, "GATEWAY_STORE_PATH");
  if (configured) {
    return configured;
  }
  if (env.NODE_ENV === "production") {
    return "/data/gateway.sqlite";
  }
  if (dataSource === "fixture-overlay" || dataSource === "dev-api-overlay") {
    return "./data/gateway.sqlite";
  }
  return "./data/gateway.sqlite";
}

function parseGoogleOAuthConfig(env: NodeJS.ProcessEnv): GoogleOAuthConfig | undefined {
  const clientId = optionalEnv(env, "GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = optionalEnv(env, "GOOGLE_OAUTH_CLIENT_SECRET");
  const redirectUri = optionalEnv(env, "GOOGLE_OAUTH_REDIRECT_URI");
  const encryptionKey = optionalEnv(env, "GOOGLE_OAUTH_ENCRYPTION_KEY");

  const set = [clientId, clientSecret, redirectUri, encryptionKey].filter(Boolean);
  if (set.length === 0) return undefined;

  if (!clientSecret) throw new Error("Missing required env var: GOOGLE_OAUTH_CLIENT_SECRET (required when GOOGLE_OAUTH_CLIENT_ID is set)");
  if (!redirectUri) throw new Error("Missing required env var: GOOGLE_OAUTH_REDIRECT_URI (required when GOOGLE_OAUTH_CLIENT_ID is set)");
  if (!encryptionKey) throw new Error("Missing required env var: GOOGLE_OAUTH_ENCRYPTION_KEY (required when GOOGLE_OAUTH_CLIENT_ID is set)");
  if (!clientId) throw new Error("Missing required env var: GOOGLE_OAUTH_CLIENT_ID");

  return { clientId, clientSecret, redirectUri, encryptionKey };
}

function parseShopifyOAuthConfig(env: NodeJS.ProcessEnv): ShopifyOAuthConfig | undefined {
  const apiKey = optionalEnv(env, "SHOPIFY_OAUTH_API_KEY");
  const apiSecret = optionalEnv(env, "SHOPIFY_OAUTH_API_SECRET");
  const redirectUri = optionalEnv(env, "SHOPIFY_OAUTH_REDIRECT_URI");
  const encryptionKey = optionalEnv(env, "SHOPIFY_OAUTH_ENCRYPTION_KEY");
  const scopesRaw = optionalEnv(env, "SHOPIFY_OAUTH_SCOPES");

  const set = [apiKey, apiSecret, redirectUri, encryptionKey, scopesRaw].filter(Boolean);
  if (set.length === 0) return undefined;

  if (!apiKey) throw new Error("Missing required env var: SHOPIFY_OAUTH_API_KEY (required when SHOPIFY_OAUTH_API_SECRET is set)");
  if (!apiSecret) throw new Error("Missing required env var: SHOPIFY_OAUTH_API_SECRET (required when SHOPIFY_OAUTH_API_KEY is set)");
  if (!redirectUri) throw new Error("Missing required env var: SHOPIFY_OAUTH_REDIRECT_URI (required when SHOPIFY_OAUTH_API_KEY is set)");
  if (!encryptionKey) throw new Error("Missing required env var: SHOPIFY_OAUTH_ENCRYPTION_KEY (required when SHOPIFY_OAUTH_API_KEY is set)");
  if (!scopesRaw) throw new Error("Missing required env var: SHOPIFY_OAUTH_SCOPES (required when SHOPIFY_OAUTH_API_KEY is set)");

  const scopes = scopesRaw.split(",").map((s) => s.trim()).filter(Boolean);
  return { apiKey, apiSecret, redirectUri, encryptionKey, scopes };
}

function parseFacebookOAuthConfig(env: NodeJS.ProcessEnv): FacebookOAuthConfig | undefined {
  const appId = optionalEnv(env, "FACEBOOK_APP_ID");
  const appSecret = optionalEnv(env, "FACEBOOK_APP_SECRET");
  const redirectUri = optionalEnv(env, "FACEBOOK_OAUTH_REDIRECT_URI");
  const encryptionKey = optionalEnv(env, "FACEBOOK_OAUTH_ENCRYPTION_KEY");
  if (!appId) return undefined;
  if (!appSecret) throw new Error("FACEBOOK_APP_SECRET required when FACEBOOK_APP_ID is set");
  if (!redirectUri) throw new Error("FACEBOOK_OAUTH_REDIRECT_URI required when FACEBOOK_APP_ID is set");
  if (!encryptionKey) throw new Error("FACEBOOK_OAUTH_ENCRYPTION_KEY required when FACEBOOK_APP_ID is set");
  return { appId, appSecret, redirectUri, encryptionKey };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const adminDataSource = parseAdminDataSource(env.ADMIN_DATA_SOURCE);

  return {
    composioApiKey: optionalEnv(env, "COMPOSIO_API_KEY"),
    composioProjectId: optionalEnv(env, "COMPOSIO_PROJECT_ID"),
    composioAdapterSlugs: parseCommaList(optionalEnv(env, "COMPOSIO_ADAPTER_SUPPORTED_SLUGS")),
    nangoAdapterSlugs: parseCommaList(optionalEnv(env, "NANGO_ADAPTER_SUPPORTED_SLUGS")),
    brandSlug: requireEnv(env, "BRAND_SLUG"),
    gatewayBearer: requireEnv(env, "GATEWAY_BEARER"),
    toolkitAllowlist: parseToolkitAllowlist(env.TOOLKIT_ALLOWLIST),
    authConfigs: parseAuthConfigs(env.AUTH_CONFIGS),
    port: parsePort(env.PORT),
    sessionTtlSeconds: parseSessionTtl(env.SESSION_TTL_SECONDS),
    adminDataSource,
    gatewayStorePath: parseGatewayStorePath(env, adminDataSource),
    haverfordDevApiBaseUrl: optionalEnv(env, "HAVERFORD_DEV_API_BASE_URL"),
    haverfordDevApiClientId: optionalEnv(env, "HAVERFORD_DEV_API_CLIENT_ID"),
    haverfordDevApiClientSecret: optionalEnv(env, "HAVERFORD_DEV_API_CLIENT_SECRET"),
    mcpAuthGateAllowedDomains: parseCommaList(env.MCP_AUTH_GATE_ALLOWED_DOMAINS),
    mcpAuthGateAllowedUsers: parseCommaList(env.MCP_AUTH_GATE_ALLOWED_USERS),
    mcpConnectionBaseUrl: optionalEnv(env, "MCP_CONNECTION_BASE_URL"),
    pipedriveFacade: {
      apiToken: optionalEnv(env, "PIPEDRIVE_API_TOKEN"),
      companyDomain: optionalEnv(env, "PIPEDRIVE_COMPANY_DOMAIN"),
      allowWrites: parseBoolean(env.PIPEDRIVE_FACADE_ALLOW_WRITES)
    },
    googleOAuth: parseGoogleOAuthConfig(env),
    shopifyOAuth: parseShopifyOAuthConfig(env),
    facebookOAuth: parseFacebookOAuthConfig(env),
    googleAdsDevToken: optionalEnv(env, "GOOGLE_ADS_DEVELOPER_TOKEN"),
  };
}
