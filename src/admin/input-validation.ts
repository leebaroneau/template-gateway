import type { Connector } from "./types.js";

const forbiddenRawSecretKeys = new Set([
  "accesstoken",
  "clientsecret",
  "refreshtoken",
  "authorization",
  "bearer",
  "password",
  "privateapikey",
  "serviceaccounttoken"
]);

export function requireText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

export function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeSlug(raw: unknown, label: string): string {
  return requireText(raw, label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeRegionCode(raw: unknown): string {
  return requireText(raw, "Region code")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeReferenceKeysFor(fieldKey: string): string[] {
  return [`${fieldKey}_ref`, "credential_ref"].filter(
    (key, index, keys) => key !== fieldKey && keys.indexOf(key) === index
  );
}

function normalizeConfigKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function isForbiddenRawSecretKey(key: string): boolean {
  return forbiddenRawSecretKeys.has(normalizeConfigKey(key));
}

function allowedConfigKeysFor(connector: Connector): Set<string> {
  const allowed = new Set<string>();
  for (const field of connector.requiredFields) {
    if (!field.secret) {
      allowed.add(field.key);
    }
  }
  return allowed;
}

function firstNonEmptyConfigValue(
  connector: Connector,
  configSummary: Record<string, unknown>,
  keys: string[]
): { key: string; value: string } | undefined {
  for (const key of keys) {
    const value = configSummary[key];
    if (typeof value !== "string") {
      if (Object.prototype.hasOwnProperty.call(configSummary, key)) {
        throw new Error(`Connector ${connector.slug} requires config field ${key} to be a string`);
      }
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return { key, value: trimmed };
    }
  }
  return undefined;
}

function requiredConfigValue(connector: Connector, configSummary: Record<string, unknown>, key: string): string {
  const value = configSummary[key];
  if (typeof value !== "string") {
    if (Object.prototype.hasOwnProperty.call(configSummary, key)) {
      throw new Error(`Connector ${connector.slug} requires config field ${key} to be a string`);
    }
    throw new Error(`Connector ${connector.slug} requires config field: ${key}`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Connector ${connector.slug} requires config field: ${key}`);
  }
  return trimmed;
}

function optionalConfigValue(
  connector: Connector,
  configSummary: Record<string, unknown>,
  key: string
): string | undefined {
  const value = configSummary[key];
  if (typeof value !== "string") {
    if (Object.prototype.hasOwnProperty.call(configSummary, key)) {
      throw new Error(`Connector ${connector.slug} requires config field ${key} to be a string`);
    }
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function sanitizeConnectionConfig(
  connector: Connector,
  configSummary: Record<string, unknown> | undefined
): Record<string, string> {
  const input = configSummary ?? {};
  const sanitized: Record<string, string> = {};
  const allowedConfigKeys = allowedConfigKeysFor(connector);

  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || !allowedConfigKeys.has(key) || isForbiddenRawSecretKey(key)) {
      continue;
    }
    sanitized[key] = trimmed;
  }

  for (const field of connector.requiredFields) {
    if (field.secret) {
      const safeReference = firstNonEmptyConfigValue(connector, input, safeReferenceKeysFor(field.key));
      if (safeReference) {
        sanitized[`${field.key}_ref`] = `fixture-redacted:${field.key}`;
        continue;
      }
      const rawSecret = optionalConfigValue(connector, input, field.key);
      if (rawSecret) {
        sanitized[`${field.key}_ref`] = `fixture-redacted:${field.key}`;
        continue;
      }
      throw new Error(`Connector ${connector.slug} requires secret config reference: ${field.key}`);
    }

    const value = requiredConfigValue(connector, input, field.key);
    if (isForbiddenRawSecretKey(field.key)) {
      throw new Error(`Connector ${connector.slug} requires unsafe config field: ${field.key}`);
    }
    sanitized[field.key] = value;
  }

  return sanitized;
}

export function sanitizePartialConfigSummary(configSummary: Record<string, unknown> | undefined): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(configSummary ?? {})) {
    if (isForbiddenRawSecretKey(key)) {
      throw new Error(`Unsafe config field: ${key}`);
    }
    if (typeof value !== "string") {
      throw new Error(`Config field ${key} must be a string`);
    }
    const trimmed = value.trim();
    if (trimmed) {
      sanitized[key] = trimmed;
    }
  }
  return sanitized;
}
