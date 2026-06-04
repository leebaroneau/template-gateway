import { describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential } from "../src/shared/token-crypto.js";

const TEST_KEY = Buffer.alloc(32, 0x42).toString("base64url");
const WRONG_KEY = Buffer.alloc(32, 0x99).toString("base64url");

interface SampleCredentialPayload {
  accessToken: string;
  shop: string;
  scope: string;
  metadata: { source: string };
}

const payload: SampleCredentialPayload = {
  accessToken: "token_abc123",
  shop: "haverford.myshopify.com",
  scope: "read_products,read_orders",
  metadata: { source: "unit-test" }
};

describe("shared token crypto", () => {
  it("roundtrips a generic credential payload", () => {
    const encrypted = encryptCredential(payload, TEST_KEY);
    expect(encrypted).toMatch(/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);

    const decrypted = decryptCredential<SampleCredentialPayload>(encrypted, TEST_KEY);

    expect(decrypted).toEqual(payload);
  });

  it("produces different ciphertext each call because the IV is random", () => {
    const first = encryptCredential(payload, TEST_KEY);
    const second = encryptCredential(payload, TEST_KEY);

    expect(first).not.toBe(second);
  });

  it("throws when decrypting with the wrong key", () => {
    const encrypted = encryptCredential(payload, TEST_KEY);

    expect(() => decryptCredential<SampleCredentialPayload>(encrypted, WRONG_KEY)).toThrow();
  });

  it("throws when the ciphertext is tampered with", () => {
    const encrypted = encryptCredential(payload, TEST_KEY);
    const tampered = encrypted.slice(0, -4) + "XXXX";

    expect(() => decryptCredential<SampleCredentialPayload>(tampered, TEST_KEY)).toThrow();
  });

  it("throws a clear error for malformed encrypted strings", () => {
    expect(() => decryptCredential<SampleCredentialPayload>("notvalid", TEST_KEY)).toThrow(
      /Invalid encrypted/
    );
  });

  it("throws a clear error when the decoded key is not 32 bytes", () => {
    const shortKey = Buffer.alloc(16, 0x42).toString("base64url");

    expect(() => encryptCredential(payload, shortKey)).toThrow(
      /Encryption key must be 32 bytes/
    );
  });
});
