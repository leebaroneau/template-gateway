import { JsonFileStore } from "../../storage/json-file-store.js";
import type { ComposioBinding, ComposioStatus } from "./types.js";

interface ComposioBindingState {
  bindings: ComposioBinding[];
}

export class ComposioBindingStore {
  private readonly store: JsonFileStore<ComposioBindingState>;

  constructor(path: string) {
    this.store = new JsonFileStore(path, { bindings: [] });
  }

  async upsert(binding: Omit<ComposioBinding, "createdAt" | "updatedAt">): Promise<ComposioStatus> {
    const now = new Date().toISOString();
    let saved: ComposioBinding | undefined;
    await this.store.update((current) => {
      const existing = current.bindings.find((candidate) =>
        candidate.provider === binding.provider && candidate.actorId === binding.actorId
      );
      saved = {
        ...binding,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };
      return {
        bindings: [
          ...current.bindings.filter((candidate) =>
            !(candidate.provider === binding.provider && candidate.actorId === binding.actorId)
          ),
          saved
        ].sort((a, b) => `${a.provider}:${a.actorId}`.localeCompare(`${b.provider}:${b.actorId}`))
      };
    });

    return statusFromBinding(saved!);
  }

  async get(provider: string, actorIdOrEmail: string): Promise<ComposioBinding | undefined> {
    const state = await this.store.read();
    const actorKey = normalizeKey(actorIdOrEmail);
    const email = actorIdOrEmail.trim().toLowerCase();
    return state.bindings.find((binding) =>
      binding.provider === provider && (binding.actorId === actorKey || binding.actorEmail === email)
    );
  }

  async status(provider: string, actorIdOrEmail: string): Promise<ComposioStatus> {
    const binding = await this.get(provider, actorIdOrEmail);
    if (!binding) {
      return {
        provider,
        backend: "composio",
        status: "disconnected",
        actorId: normalizeKey(actorIdOrEmail),
        connectedAccountIds: []
      };
    }
    return statusFromBinding(binding);
  }
}

function statusFromBinding(binding: ComposioBinding): ComposioStatus {
  return {
    provider: binding.provider,
    backend: "composio",
    status: binding.status,
    actorId: binding.actorId,
    actorEmail: binding.actorEmail,
    actorName: binding.actorName,
    composioUserId: binding.composioUserId,
    sessionId: binding.sessionId,
    connectedAccountIds: [...binding.connectedAccountIds]
  };
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}
