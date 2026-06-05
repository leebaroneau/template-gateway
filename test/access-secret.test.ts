import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createApiKeySecret,
  fingerprintApiKeySecret,
  hashApiKeySecret,
  previewApiKeySecret,
  verifyApiKeySecret
} from "../src/access/secret.js";
import { isGatewayApiScope, scopeAllowed, validateGatewayApiScopes } from "../src/access/types.js";

const scryptParams = { N: 16384, r: 8, p: 1 };

describe("API key secret utilities", () => {
  it("generates gateway-prefixed one-time secrets", () => {
    const secret = createApiKeySecret();

    expect(secret).toMatch(/^gw_live_[A-Za-z0-9_-]{32,}$/);
    expect(secret).toHaveLength(51);
  });

  it("previews secrets with only the prefix and final four characters", () => {
    const secret = createApiKeySecret();

    expect(previewApiKeySecret(secret)).toBe(`gw_live_...${secret.slice(-4)}`);
  });

  it("uses stable short fingerprints for the same secret", () => {
    const secret = createApiKeySecret();

    expect(fingerprintApiKeySecret(secret)).toMatch(/^[a-f0-9]{16}$/);
    expect(fingerprintApiKeySecret(secret)).toBe(fingerprintApiKeySecret(secret));
  });

  it("hashes and verifies secrets without storing the raw value", () => {
    const secret = createApiKeySecret();
    const hash = hashApiKeySecret(secret);
    const parts = hash.split("$");
    const [algorithm, n, r, p, salt, derived] = parts;

    expect(hash).toMatch(/^scrypt\$/);
    expect(parts).toHaveLength(6);
    expect([algorithm, n, r, p]).toEqual(["scrypt", "16384", "8", "1"]);
    expect(salt).toBeTruthy();
    expect(derived).toBeTruthy();
    expect(hash).not.toContain(secret);
    expect(verifyApiKeySecret(secret, hash)).toBe(true);
    expect(verifyApiKeySecret(`${secret}x`, hash)).toBe(false);
  });

  it("rejects stored hashes with truncated derived values", () => {
    const secret = createApiKeySecret();
    const [, n, r, p, salt] = hashApiKeySecret(secret).split("$");
    const shortDerived = crypto.scryptSync(secret, salt, 1, scryptParams).toString("base64url");
    const truncatedHash = `scrypt$${n}$${r}$${p}$${salt}$${shortDerived}`;

    expect(verifyApiKeySecret(secret, truncatedHash)).toBe(false);
  });

  it("rejects malformed stored hash params and layout", () => {
    const secret = createApiKeySecret();
    const [, , , , salt] = hashApiKeySecret(secret).split("$");
    const weakParams = { N: 1024, r: 8, p: 1 };
    const weakDerived = crypto.scryptSync(secret, salt, 32, weakParams).toString("base64url");
    const shortSalt = "abcd";
    const shortSaltDerived = crypto.scryptSync(secret, shortSalt, 32, scryptParams).toString("base64url");

    expect(verifyApiKeySecret(secret, `scrypt$1024$8$1$${salt}$${weakDerived}`)).toBe(false);
    expect(verifyApiKeySecret(secret, `scrypt$16384$8$1$${shortSalt}$${shortSaltDerived}`)).toBe(false);
    expect(verifyApiKeySecret(secret, `scrypt$16384$8$1$${salt}`)).toBe(false);
    expect(verifyApiKeySecret(secret, `sha256$16384$8$1$${salt}$${weakDerived}`)).toBe(false);
  });
});

describe("gateway API scope helpers", () => {
  it("validates and de-duplicates known scopes in first-seen order", () => {
    expect(isGatewayApiScope("brands.read")).toBe(true);
    expect(isGatewayApiScope("mcp.read")).toBe(true);
    expect(isGatewayApiScope("unknown.read")).toBe(false);
    expect(validateGatewayApiScopes(["brands.read", "mcp.read", "audit.read", "brands.read"])).toEqual([
      "brands.read",
      "mcp.read",
      "audit.read"
    ]);
  });

  it("rejects non-array and unknown scope inputs", () => {
    expect(() => validateGatewayApiScopes("brands.read")).toThrow(/scopes must be an array/);
    expect(() => validateGatewayApiScopes(["brands.read", "unknown.read"])).toThrow(
      /Unknown API scope: unknown\.read/
    );
  });

  it("allows api client write scope to satisfy api client reads", () => {
    expect(scopeAllowed(["api_clients.write"], "api_clients.read")).toBe(true);
    expect(scopeAllowed(["api_clients.read"], "api_clients.write")).toBe(false);
    expect(scopeAllowed(["brands.read"], "brands.read")).toBe(true);
  });

  it("allows apps.write scope to satisfy apps.read", () => {
    expect(scopeAllowed(["apps.write"], "apps.read")).toBe(true);
    expect(scopeAllowed(["apps.read"], "apps.write")).toBe(false);
    expect(scopeAllowed(["apps.read"], "apps.read")).toBe(true);
    expect(scopeAllowed(["apps.write"], "apps.write")).toBe(true);
  });

  it("treats mcp.read as its own explicit scope", () => {
    expect(scopeAllowed(["mcp.read"], "mcp.read")).toBe(true);
    expect(scopeAllowed(["connections.read"], "mcp.read")).toBe(false);
    expect(scopeAllowed(["mcp.read"], "connections.read")).toBe(false);
  });
});
