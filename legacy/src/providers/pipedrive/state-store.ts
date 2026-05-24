import { randomUUID } from "node:crypto";
import { JsonFileStore } from "../../storage/json-file-store.js";
import type { PipedriveActor } from "./types.js";

interface StoredPipedriveOAuthState extends PipedriveActor {
  state: string;
  provider: "pipedrive";
  createdAt: string;
  expiresAt: string;
}

interface PipedriveOAuthStateData {
  states: StoredPipedriveOAuthState[];
}

export class PipedriveOAuthStateStore {
  private readonly store: JsonFileStore<PipedriveOAuthStateData>;

  constructor(
    path: string,
    private readonly ttlMs = 30 * 60 * 1000
  ) {
    this.store = new JsonFileStore(path, { states: [] });
  }

  async create(actor: PipedriveActor): Promise<StoredPipedriveOAuthState> {
    const now = new Date();
    const state: StoredPipedriveOAuthState = {
      state: randomUUID(),
      provider: "pipedrive",
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

  async consume(state: string): Promise<StoredPipedriveOAuthState | undefined> {
    const now = new Date();
    let matched: StoredPipedriveOAuthState | undefined;
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

function isExpired(state: StoredPipedriveOAuthState, now = new Date()): boolean {
  return Date.parse(state.expiresAt) <= now.getTime();
}
