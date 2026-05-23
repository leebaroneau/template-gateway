import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { JsonFileStore } from "../../storage/json-file-store.js";
import type { PipedriveActor, PipedriveBinding, PipedriveStatus, PipedriveTokenPayload } from "./types.js";

interface PipedriveTokenData {
  bindings: PipedriveBinding[];
}

interface SaveBindingInput extends PipedriveActor {
  upstreamLogin: string;
  upstreamName?: string;
  apiDomain?: string;
  scope?: string;
  expiresAt?: string;
  payload: PipedriveTokenPayload;
}

export class PipedriveTokenStore {
  private readonly store: JsonFileStore<PipedriveTokenData>;

  constructor(
    path: string,
    private readonly keyBase64?: string
  ) {
    this.store = new JsonFileStore(path, { bindings: [] });
  }

  async saveConnectedBinding(input: SaveBindingInput): Promise<PipedriveStatus> {
    const actorId = actorKey(input.actorId ?? input.actorEmail);
    const now = new Date().toISOString();
    const tokenCiphertext = encryptTokenPayload(input.payload, this.keyBase64);
    const existing = (await this.store.read()).bindings.find((binding) => binding.actorId === actorId);
    const binding: PipedriveBinding = {
      actorId,
      actorEmail: input.actorEmail.trim().toLowerCase(),
      actorName: input.actorName,
      provider: "pipedrive",
      upstreamLogin: input.upstreamLogin.trim().toLowerCase(),
      upstreamName: input.upstreamName,
      apiDomain: input.apiDomain,
      scope: input.scope,
      scopes: splitScopes(input.scope),
      expiresAt: input.expiresAt,
      tokenCiphertext,
      status: "connected",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    await this.store.update((current) => ({
      bindings: [
        ...current.bindings.filter((candidate) => candidate.actorId !== actorId),
        binding
      ].sort((a, b) => a.actorId.localeCompare(b.actorId))
    }));

    return statusFromBinding(binding);
  }

  async status(actorIdOrEmail: string): Promise<PipedriveStatus> {
    const binding = await this.getBinding(actorIdOrEmail);
    if (!binding) {
      return {
        provider: "pipedrive",
        status: "disconnected",
        actorId: actorKey(actorIdOrEmail),
        scopes: []
      };
    }
    return statusFromBinding(binding);
  }

  async getBinding(actorIdOrEmail: string): Promise<PipedriveBinding | undefined> {
    const state = await this.store.read();
    const key = actorKey(actorIdOrEmail);
    const email = actorIdOrEmail.trim().toLowerCase();
    return state.bindings.find((binding) => binding.actorId === key || binding.actorEmail === email);
  }

  async readTokenPayload(actorIdOrEmail: string): Promise<PipedriveTokenPayload | undefined> {
    const binding = await this.getBinding(actorIdOrEmail);
    return binding ? decryptTokenPayload(binding.tokenCiphertext, this.keyBase64) : undefined;
  }
}

function statusFromBinding(binding: PipedriveBinding): PipedriveStatus {
  return {
    provider: "pipedrive",
    status: binding.status,
    actorId: binding.actorId,
    actorEmail: binding.actorEmail,
    actorName: binding.actorName,
    upstreamLogin: binding.upstreamLogin,
    upstreamName: binding.upstreamName,
    apiDomain: binding.apiDomain,
    scopes: binding.scopes,
    expiresAt: binding.expiresAt
  };
}

function encryptTokenPayload(payload: PipedriveTokenPayload, keyBase64?: string): string {
  const key = decodeKey(keyBase64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

function decryptTokenPayload(ciphertext: string, keyBase64?: string): PipedriveTokenPayload {
  const key = decodeKey(keyBase64);
  const [version, ivBase64, tagBase64, ciphertextBase64] = ciphertext.split(".");
  if (version !== "v1" || !ivBase64 || !tagBase64 || !ciphertextBase64) {
    throw new Error("Unsupported Pipedrive token ciphertext format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivBase64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagBase64, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64url")),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString("utf8")) as PipedriveTokenPayload;
}

function decodeKey(keyBase64?: string): Buffer {
  if (!keyBase64) {
    throw new Error("Pipedrive token store key is not configured.");
  }
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("Pipedrive token store key must decode to 32 bytes.");
  }
  return key;
}

function actorKey(value: string): string {
  return value.trim().toLowerCase();
}

function splitScopes(scope: string | undefined): string[] {
  if (!scope) return [];
  return scope.split(/\s+/).map((part) => part.trim()).filter(Boolean);
}
