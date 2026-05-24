import type { Request, Response } from "express";
import type { SessionCache, SessionFactory } from "./session-cache.js";

/**
 * Factory that builds Composio Tool Router sessions. Decoupled from the SDK
 * so tests can stub it.
 */
export function makeComposioSessionFactory(opts: {
  composioApiKey: string;
  composioProjectId?: string;
  toolkitAllowlist?: string[];
  authConfigs?: Record<string, string>;
}): SessionFactory {
  // Lazy-load the Composio SDK so unit tests can avoid network calls.
  let clientPromise: Promise<{ create: (userId: string, config?: Record<string, unknown>) => Promise<unknown> }> | undefined;
  async function getClient() {
    if (!clientPromise) {
      clientPromise = (async () => {
        const mod = await import("@composio/core");
        const composio = new mod.Composio({ apiKey: opts.composioApiKey });
        return composio.toolRouter;
      })();
    }
    return clientPromise;
  }

  return async function (userId: string) {
    const client = await getClient();
    const sessionConfig: Record<string, unknown> = {};
    if (opts.toolkitAllowlist?.length) {
      sessionConfig.toolkits = opts.toolkitAllowlist;
    }
    if (opts.authConfigs && Object.keys(opts.authConfigs).length) {
      // Composio Tool Router auto-creates auth configs for managed-OAuth toolkits
      // but requires an explicit map for toolkits whose auth was provided by the
      // user (API key auth like microsoft_clarity, or custom OAuth like pipedrive
      // / docusign). SDK schema is camelCase even though the API returns the
      // snake_case form in error messages. Map shape: { toolkit_slug: "ac_xxx" }.
      sessionConfig.authConfigs = opts.authConfigs;
    }
    if (opts.composioProjectId) {
      sessionConfig.projectId = opts.composioProjectId;
    }
    const session = (await client.create(userId, sessionConfig)) as {
      url?: string;
      mcpUrl?: string;
      headers?: Record<string, string>;
    };
    const url = session.mcpUrl ?? session.url;
    if (!url) {
      throw new Error("Composio Tool Router did not return a session URL");
    }
    return {
      url,
      headers: session.headers ?? { "x-api-key": opts.composioApiKey }
    };
  };
}

interface ForwardOptions {
  cache: SessionCache;
  fetchImpl?: typeof fetch;
}

/**
 * Forwards a single MCP JSON-RPC request to the Composio Tool Router session
 * bound to the actor's user_id. Used by both the POST and DELETE handlers.
 *
 * GET (SSE) requires a streaming pipe — see `forwardEventStream`.
 */
export async function forwardJsonRpc(req: Request, res: Response, options: ForwardOptions): Promise<void> {
  const userId = req.actor?.userId;
  if (!userId) {
    res.status(400).json({ error: "missing actor context" });
    return;
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  let session;
  try {
    session = await options.cache.get(userId);
  } catch (err) {
    options.cache.invalidate(userId);
    // eslint-disable-next-line no-console
    console.error(`[gateway] session create failed for user_id=${userId}:`, err);
    res.status(502).json({
      error: "failed to create Composio Tool Router session",
      detail: err instanceof Error ? err.message : String(err)
    });
    return;
  }

  const init: RequestInit = {
    method: req.method,
    headers: {
      ...session.headers,
      "content-type": "application/json",
      accept: req.header("accept") ?? "application/json"
    },
    body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body ?? {})
  };

  let upstream: globalThis.Response;
  try {
    upstream = await fetchImpl(session.url, init);
  } catch (err) {
    options.cache.invalidate(userId);
    res.status(502).json({
      error: "upstream Composio Tool Router unreachable",
      detail: err instanceof Error ? err.message : String(err)
    });
    return;
  }

  // Composio may rotate session URLs on auth failure; invalidate so next call rebuilds.
  if (upstream.status === 401 || upstream.status === 403 || upstream.status === 404) {
    options.cache.invalidate(userId);
  }

  res.status(upstream.status);
  const passthroughHeaders = ["content-type", "mcp-session-id", "cache-control"];
  for (const name of passthroughHeaders) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  const text = await upstream.text();
  res.send(text);
}
