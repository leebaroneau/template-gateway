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

  it("continues processing later updates after a mutator fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "template-gateway-store-"));
    const path = join(dir, "state.json");
    const store = new JsonFileStore(path, { count: 0 });

    await expect(
      store.update(() => {
        throw new Error("mutator failed");
      })
    ).rejects.toThrow("mutator failed");

    await expect(store.update((current) => ({ count: current.count + 1 }))).resolves.toEqual({ count: 1 });
    expect(await store.read()).toEqual({ count: 1 });
  });

  it("uses collision-resistant temp files for concurrent writers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "template-gateway-store-"));
    const path = join(dir, "state.json");
    const values = Array.from({ length: 20 }, (_, index) => ({ count: index }));

    await Promise.all(values.map((value) => new JsonFileStore(path, { count: -1 }).write(value)));

    expect(values).toContainEqual(JSON.parse(await readFile(path, "utf8")));
  });
});
