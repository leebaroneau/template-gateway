import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { JsonFileStore } from "../src/storage/json-file-store.js";

describe("JsonFileStore", () => {
  it("reads default state and writes updates atomically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "template-gateway-store-"));
    const path = join(dir, "state.json");
    const store = new JsonFileStore(path, { count: 0 });

    expect(await store.read()).toEqual({ count: 0 });
    await store.update((current) => ({ count: current.count + 1 }));
    expect(await store.read()).toEqual({ count: 1 });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ count: 1 });
  });
});
