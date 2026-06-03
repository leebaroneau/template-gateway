import { describe, expect, it } from "vitest";
import {
  createApiKeySecret,
  fingerprintApiKeySecret,
  hashApiKeySecret,
  previewApiKeySecret,
  verifyApiKeySecret
} from "../src/access/secret.js";
import { isGatewayApiScope, scopeAllowed, validateGatewayApiScopes } from "../src/access/types.js";

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
    const [algorithm, n, r, p, salt, derived] = hash.split("$");

    expect(hash).toMatch(/^scrypt\$/);
    expect([algorithm, n, r, p]).toEqual(["scrypt", "16384", "8", "1"]);
    expect(salt).toBeTruthy();
    expect(derived).toBeTruthy();
    expect(hash).not.toContain(secret);
    expect(verifyApiKeySecret(secret, hash)).toBe(true);
    expect(verifyApiKeySecret(`${secret}x`, hash)).toBe(false);
  });
});

describe("gateway API scope helpers", () => {
  it("validates and de-duplicates known scopes in first-seen order", () => {
    expect(isGatewayApiScope("brands.read")).toBe(true);
    expect(isGatewayApiScope("unknown.read")).toBe(false);
    expect(validateGatewayApiScopes(["brands.read", "audit.read", "brands.read"])).toEqual([
      "brands.read",
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
});
