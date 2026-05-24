import { randomUUID } from "node:crypto";
import { JsonFileStore } from "../../storage/json-file-store.js";
import type { MicrosoftActor } from "./types.js";

interface StoredMicrosoftOAuthState extends MicrosoftActor {
  state: string;
  provider: "microsoft";
  createdAt: string;
  expiresAt: string;
}

interface MicrosoftOAuthStateData {
  states: StoredMicrosoftOAuthState[];
}

export class MicrosoftOAuthStateStore {
  private readonly store: JsonFileStore<MicrosoftOAuthStateData>;

  constructor(
    path: string,
    private readonly ttlMs = 30 * 60 * 1000
  ) {
    this.store = new JsonFileStore(path, { states: [] });
  }

  async create(actor: MicrosoftActor): Promise<StoredMicrosoftOAuthState> {
    const now = new Date();
    const state: StoredMicrosoftOAuthState = {
      state: randomUUID(),
      provider: "microsoft",
      actorId: actor.actorId,
      actorEmail: actor.actorEmail.trim().toLowerCase(),
      actorName: actor.actorName,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString()
    };

    await this.store.update((current) => ({
      states: [
        ...current.states.filter((candidate) => !isExpired(candidate, now)),
        state
      ]
    }));

    return state;
  }

  async consume(state: string): Promise<StoredMicrosoftOAuthState | undefined> {
    const now = new Date();
    let matched: StoredMicrosoftOAuthState | undefined;
    await this.store.update((current) => {
      const states = current.states.filter((candidate) => {
        if (candidate.state === state) {
          matched = isExpired(candidate, now) ? undefined : candidate;
          return false;
        }
        return !isExpired(candidate, now);
      });
      return { states };
    });
    return matched;
  }
}

function isExpired(state: StoredMicrosoftOAuthState, now = new Date()): boolean {
  return Date.parse(state.expiresAt) <= now.getTime();
}
