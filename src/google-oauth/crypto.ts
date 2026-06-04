import crypto from "node:crypto";
import type { GoogleTokenPayload } from "./types.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function decodeKey(base64urlKey: string): Buffer {
  const key = Buffer.from(base64urlKey, "base64url");
  if (key.length !== 32) {
    throw new Error(`Encryption key must be 32 bytes (got ${key.length})`);
  }
  return key;
}

export function encryptCredential(payload: GoogleTokenPayload, base64urlKey: string): string {
  const key = decodeKey(base64urlKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const plaintext = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptCredential(encrypted: string, base64urlKey: string): GoogleTokenPayload {
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted credential format");
  }
  const [ivPart, tagPart, ciphertextPart] = parts;
  const key = decodeKey(base64urlKey);
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ciphertextPart, "base64url");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as GoogleTokenPayload;
}
