import { z } from "zod";

const configSchema = z.object({
  port: z.number().int().min(1).max(65535),
  apiBaseUrl: z.string().url(),
  allowedEmailDomains: z.array(z.string().min(1)),
  tokenStorePath: z.string().min(1),
  auditLogPath: z.string().min(1),
  apiBearerTokens: z.array(z.string().min(32)),
  enableComposioProviders: z.boolean(),
  enabledProviders: z.array(z.string().min(1)),
  microsoft: z.object({
    clientId: z.string().min(1).optional(),
    clientSecret: z.string().min(1).optional(),
    tenantId: z.string().min(1).optional(),
    redirectUri: z.string().url(),
    allowedTenants: z.array(z.string().min(1)),
    allowedDomains: z.array(z.string().min(1)),
    tokenStorePath: z.string().min(1),
    tokenStoreKey: z.string().optional(),
    scopes: z.array(z.string().min(1)),
    graphRequestPathAllowlist: z.array(z.string().min(1)).min(1),
    sendEmailEnabled: z.boolean()
  }),
  pipedrive: z.object({
    clientId: z.string().min(1).optional(),
    clientSecret: z.string().min(1).optional(),
    redirectUri: z.string().url(),
    companyDomain: z.string().min(1).optional(),
    allowedDomains: z.array(z.string().min(1)),
    tokenStorePath: z.string().min(1),
    tokenStoreKey: z.string().optional(),
    scopes: z.array(z.string().min(1)),
    authorizeUrl: z.string().url(),
    tokenUrl: z.string().url()
  }),
  composio: z.object({
    apiKey: z.string().min(1).optional(),
    bindingStorePath: z.string().min(1),
    clientSlug: z.string().min(1),
    authConfigs: z.record(z.string().min(1)),
    providers: z.object({
      microsoft: z.object({
        toolkits: z.array(z.string().min(1)).min(1),
        primaryToolkit: z.string().min(1)
      }),
      google: z.object({
        toolkits: z.array(z.string().min(1)).min(1),
        primaryToolkit: z.string().min(1)
      })
    })
  }).optional()
});

export type GatewayConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const apiBaseUrl = env.API_BASE_URL ?? "http://localhost:3000";
  const allowedEmailDomains = splitCsv(env.ALLOWED_EMAIL_DOMAINS ?? "example.com");
  const microsoftTenantId = optionalString(env.MICROSOFT_TENANT_ID);
  const enableComposio = parseBoolean(env.ENABLE_COMPOSIO_PROVIDERS, false);
  const microsoftToolkits = splitCsv(env.COMPOSIO_MICROSOFT_TOOLKITS ?? "outlook,calendar,onedrive");
  const googleToolkits = splitCsv(env.COMPOSIO_GOOGLE_TOOLKITS ?? "gmail,googlecalendar,googledrive");

  return configSchema.parse({
    port: parseInteger(env.PORT, 3000),
    apiBaseUrl,
    allowedEmailDomains,
    tokenStorePath: env.TOKEN_STORE_PATH ?? "./data/tokens.json",
    auditLogPath: env.AUDIT_LOG_PATH ?? "./data/audit.jsonl",
    apiBearerTokens: splitCsv(env.API_BEARER_TOKENS ?? ""),
    enableComposioProviders: enableComposio,
    enabledProviders: splitCsv(env.ENABLED_PROVIDERS ?? "microsoft"),
    composio: enableComposio ? {
      apiKey: optionalString(env.COMPOSIO_API_KEY),
      bindingStorePath: env.COMPOSIO_BINDING_STORE_PATH ?? "./data/composio-bindings.json",
      clientSlug: optionalString(env.COMPOSIO_CLIENT_SLUG) ?? "local",
      authConfigs: parseJsonRecord(env.COMPOSIO_AUTH_CONFIGS_JSON ?? "{}"),
      providers: {
        microsoft: {
          toolkits: microsoftToolkits,
          primaryToolkit: optionalString(env.COMPOSIO_MICROSOFT_PRIMARY_TOOLKIT) ?? microsoftToolkits[0]
        },
        google: {
          toolkits: googleToolkits,
          primaryToolkit: optionalString(env.COMPOSIO_GOOGLE_PRIMARY_TOOLKIT) ?? googleToolkits[0]
        }
      }
    } : undefined,
    microsoft: {
      clientId: optionalString(env.MICROSOFT_CLIENT_ID),
      clientSecret: optionalString(env.MICROSOFT_CLIENT_SECRET),
      tenantId: microsoftTenantId,
      redirectUri: env.MICROSOFT_REDIRECT_URI ?? new URL("/auth/microsoft/callback", apiBaseUrl).toString(),
      allowedTenants: splitCsv(env.MICROSOFT_ALLOWED_TENANTS ?? microsoftTenantId ?? ""),
      allowedDomains: splitCsv(env.MICROSOFT_ALLOWED_DOMAINS ?? allowedEmailDomains.join(",")),
      tokenStorePath: env.MICROSOFT_TOKEN_STORE_PATH ?? "./data/microsoft-tokens.json",
      tokenStoreKey: optionalString(env.MICROSOFT_TOKEN_STORE_KEY),
      scopes: splitScopes(env.MICROSOFT_SCOPES ?? "offline_access User.Read Mail.Read Calendars.Read"),
      graphRequestPathAllowlist: splitCsv(env.MICROSOFT_TOOL_PATH_ALLOWLIST ?? "/me,/me/messages,/me/calendar"),
      sendEmailEnabled: parseBoolean(env.MICROSOFT_SEND_EMAIL_ENABLED, false)
    },
    pipedrive: {
      clientId: optionalString(env.PIPEDRIVE_CLIENT_ID),
      clientSecret: optionalString(env.PIPEDRIVE_CLIENT_SECRET),
      redirectUri: env.PIPEDRIVE_REDIRECT_URI ?? new URL("/auth/pipedrive/callback", apiBaseUrl).toString(),
      companyDomain: optionalString(env.PIPEDRIVE_COMPANY_DOMAIN),
      allowedDomains: splitCsv(env.PIPEDRIVE_ALLOWED_DOMAINS ?? allowedEmailDomains.join(",")),
      tokenStorePath: env.PIPEDRIVE_TOKEN_STORE_PATH ?? "./data/pipedrive-tokens.json",
      tokenStoreKey: optionalString(env.PIPEDRIVE_TOKEN_STORE_KEY),
      scopes: splitScopes(env.PIPEDRIVE_SCOPES ?? ""),
      authorizeUrl: env.PIPEDRIVE_AUTHORIZE_URL ?? "https://oauth.pipedrive.com/oauth/authorize",
      tokenUrl: env.PIPEDRIVE_TOKEN_URL ?? "https://oauth.pipedrive.com/oauth/token"
    }
  });
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`Expected decimal integer value, received: ${value}`);
  }
  return Number.parseInt(value, 10);
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitScopes(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Expected boolean value, received: ${value}`);
}

function parseJsonRecord(value: string): Record<string, string> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object for auth config mapping.");
  }
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(parsed)) {
    if (typeof raw !== "string" || !raw.trim()) {
      throw new Error(`Expected non-empty string auth config id for toolkit: ${key}`);
    }
    output[key.trim()] = raw.trim();
  }
  return output;
}
