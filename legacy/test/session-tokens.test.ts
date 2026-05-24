import { access, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { SessionTokenStore } from "../src/auth/session-tokens.js";

describe("SessionTokenStore", () => {
  it("issues and verifies user bearer tokens", async () => {
    const store = new SessionTokenStore(join(await tmp(), "tokens.json"), ["genvest.com.au"], []);
    const issued = await store.issue("Lee@Genvest.com.au", "claude", ["mcp:tools"]);
    const auth = await store.verifyAccessToken(issued.access_token);
    const extra = auth.extra;

    expect(extra).toBeDefined();
    if (!extra) throw new Error("Expected auth extra.");
    expect(extra.email).toBe("lee@genvest.com.au");
    expect(auth.scopes).toEqual(["mcp:tools"]);
  });

  it("rejects emails outside allowed domains", async () => {
    const store = new SessionTokenStore(join(await tmp(), "tokens.json"), ["genvest.com.au"], []);
    await expect(store.issue("person@example.com", "claude", ["mcp:tools"])).rejects.toThrow(/domain/i);
  });

  it("verifies static service tokens without storing them", async () => {
    const token = "abcdefghijklmnopqrstuvwxyz123456";
    const path = join(await tmp(), "tokens.json");
    const store = new SessionTokenStore(path, ["genvest.com.au"], [
      { token, email: "bot@genvest.com.au", name: "@bot", profile: "genvest-bot" }
    ]);

    const auth = await store.verifyAccessToken(token);
    expect(auth.extra).toMatchObject({
      email: "bot@genvest.com.au",
      name: "@bot",
      profile: "genvest-bot",
      isStaticServiceToken: true
    });
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "template-gateway-sessions-"));
}
