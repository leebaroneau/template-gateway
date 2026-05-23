import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class JsonFileStore<T extends object> {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly defaultValue: T
  ) {}

  async read(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as T;
    } catch (error: any) {
      if (error?.code === "ENOENT") return structuredClone(this.defaultValue);
      throw error;
    }
  }

  async write(value: T): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmpPath = `${this.path}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.path);
  }

  async update(mutator: (current: T) => T | Promise<T>): Promise<T> {
    let nextValue!: T;
    this.writeQueue = this.writeQueue.then(async () => {
      const current = await this.read();
      nextValue = await mutator(current);
      await this.write(nextValue);
    });
    await this.writeQueue;
    return nextValue;
  }
}
