import { z } from "zod";

const configSchema = z.object({
  port: z.number().int().min(1).max(65535),
  apiBaseUrl: z.string().url(),
  allowedEmailDomains: z.array(z.string().min(1)),
  tokenStorePath: z.string().min(1),
  auditLogPath: z.string().min(1),
  apiBearerTokens: z.array(z.string().min(32))
});

export type GatewayConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return configSchema.parse({
    port: parseInteger(env.PORT, 3000),
    apiBaseUrl: env.API_BASE_URL ?? "http://localhost:3000",
    allowedEmailDomains: splitCsv(env.ALLOWED_EMAIL_DOMAINS ?? "example.com"),
    tokenStorePath: env.TOKEN_STORE_PATH ?? "./data/tokens.json",
    auditLogPath: env.AUDIT_LOG_PATH ?? "./data/audit.jsonl",
    apiBearerTokens: splitCsv(env.API_BEARER_TOKENS ?? "")
  });
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
