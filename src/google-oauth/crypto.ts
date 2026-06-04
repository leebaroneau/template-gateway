import type { GoogleTokenPayload } from "./types.js";
import {
  decryptCredential as sharedDecryptCredential,
  encryptCredential as sharedEncryptCredential
} from "../shared/token-crypto.js";

export const encryptCredential = (payload: GoogleTokenPayload, base64urlKey: string): string =>
  sharedEncryptCredential(payload, base64urlKey);

export const decryptCredential = (encrypted: string, base64urlKey: string): GoogleTokenPayload =>
  sharedDecryptCredential<GoogleTokenPayload>(encrypted, base64urlKey);
