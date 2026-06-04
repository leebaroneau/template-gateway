import { describe, expect, it } from "vitest";
import type { ShopifyTokenPayload } from "../src/shopify-oauth/types.js";
import { decryptCredential, encryptCredential } from "../src/shopify-oauth/crypto.js";

const TEST_KEY = Buffer.alloc(32, 0x42).toString("base64url");
const WRONG_KEY = Buffer.alloc(32, 0x99).toString("base64url");

describe("encryptCredential / decryptCredential (ShopifyTokenPayload)", () => {
  const payload: ShopifyTokenPayload = {
    accessToken: "tok",
    scope: "read_products",
    shop: "test.myshopify.com",
  };

  it("roundtrips correctly", () => {
    const encrypted = encryptCredential(payload, TEST_KEY);
    expect(encrypted).toMatch(/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    const decrypted = decryptCredential(encrypted, TEST_KEY);
    expect(decrypted).toEqual(payload);
  });

  it("produces different ciphertext each call (random IV)", () => {
    const a = encryptCredential(payload, TEST_KEY);
    const b = encryptCredential(payload, TEST_KEY);
    expect(a).not.toBe(b);
  });

  it("throws on wrong key", () => {
    const encrypted = encryptCredential(payload, TEST_KEY);
    expect(() => decryptCredential(encrypted, WRONG_KEY)).toThrow();
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encryptCredential(payload, TEST_KEY);
    const tampered = encrypted.slice(0, -4) + "XXXX";
    expect(() => decryptCredential(tampered, TEST_KEY)).toThrow();
  });

  it("throws on malformed encrypted string", () => {
    expect(() => decryptCredential("bad", TEST_KEY)).toThrow(/Invalid encrypted/);
  });

  it("throws if key is not 32 bytes when decoded", () => {
    const shortKey = Buffer.alloc(16, 0x42).toString("base64url");
    expect(() => encryptCredential(payload, shortKey)).toThrow(/Encryption key must be 32 bytes/);
  });
});
