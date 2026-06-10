type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface PipedriveFacadeConfig {
  apiToken?: string;
  companyDomain?: string;
  allowWrites?: boolean;
}

type FetchLike = typeof fetch;

const READ_METHODS = new Set(["GET"]);
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const pipedriveFacadeToolNames = [
  "pipedrive_api_request",
  "pipedrive_pipeline_shape",
  "pipedrive_search",
  "pipedrive_search_deals",
  "pipedrive_get_deal",
  "pipedrive_list_deals",
  "pipedrive_create_person",
  "pipedrive_create_organization",
  "pipedrive_create_deal",
  "pipedrive_update_deal",
  "pipedrive_create_activity",
  "pipedrive_connect_me",
  "pipedrive_v1_getDealFields",
  "pipedrive_v1_getStages",
  "pipedrive_v1_getUsers",
  "pipedrive_v1_downloadFile"
] as const;

export function isPipedriveFacadeConfigured(config: PipedriveFacadeConfig): boolean {
  return Boolean(config.apiToken?.trim() && config.companyDomain?.trim());
}

export function createPipedriveFacade(config: PipedriveFacadeConfig, fetchImpl: FetchLike = globalThis.fetch) {
  return {
    async handleJsonRpc(request: JsonRpcRequest, upstreamToolsList?: { tools?: Array<Record<string, unknown>> }): Promise<JsonRpcResponse | undefined> {
      if (!isPipedriveFacadeConfigured(config)) return undefined;

      if (request.method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: {
            tools: mergeTools(upstreamToolsList?.tools ?? [], facadeTools())
          }
        };
      }

      if (request.method !== "tools/call") return undefined;
      const params = request.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      const toolName = params?.name;
      if (!toolName || !isPipedriveFacadeTool(toolName)) return undefined;

      try {
        const result = await callFacadeTool(toolName, params.arguments ?? {}, config, fetchImpl);
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result
        };
      } catch (error) {
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: toolResult(error instanceof Error ? error.message : "Pipedrive facade call failed.", {
            status: "error",
            message: error instanceof Error ? error.message : String(error)
          }, true)
        };
      }
    }
  };
}

function isPipedriveFacadeTool(name: string): boolean {
  return (pipedriveFacadeToolNames as readonly string[]).includes(name);
}

function facadeTools(): Array<Record<string, unknown>> {
  return [
    tool("pipedrive_api_request", "Call an authenticated Pipedrive REST endpoint.", {
      method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      path: { type: "string" },
      query: { type: "object", additionalProperties: true },
      body: { type: "object", additionalProperties: true }
    }, ["method", "path"]),
    tool("pipedrive_pipeline_shape", "Return live Pipedrive pipelines and stages.", {}),
    tool("pipedrive_search", "Search Pipedrive items.", {
      term: { type: "string" },
      itemTypes: { type: "array", items: { type: "string" } },
      fields: { type: "array", items: { type: "string" } },
      exactMatch: { type: "boolean" },
      limit: { type: "integer" }
    }, ["term"]),
    tool("pipedrive_search_deals", "Search Pipedrive deals by term.", {
      term: { type: "string" },
      fields: { type: "array", items: { type: "string" } },
      exactMatch: { type: "boolean" },
      status: { type: "string", enum: ["open", "won", "lost"] },
      limit: { type: "integer" }
    }, ["term"]),
    tool("pipedrive_get_deal", "Get one Pipedrive deal by ID.", {
      id: { type: "integer" }
    }, ["id"]),
    tool("pipedrive_list_deals", "List Pipedrive deals.", {
      pipeline_id: { type: "integer" },
      status: { type: "string" },
      limit: { type: "integer" },
      start: { type: "integer" }
    }),
    tool("pipedrive_create_person", "Create a Pipedrive person.", { body: { type: "object", additionalProperties: true } }, ["body"]),
    tool("pipedrive_create_organization", "Create a Pipedrive organization.", { body: { type: "object", additionalProperties: true } }, ["body"]),
    tool("pipedrive_create_deal", "Create a Pipedrive deal.", { body: { type: "object", additionalProperties: true } }, ["body"]),
    tool("pipedrive_update_deal", "Update a Pipedrive deal.", {
      id: { type: "integer" },
      body: { type: "object", additionalProperties: true }
    }, ["id", "body"]),
    tool("pipedrive_create_activity", "Create a Pipedrive activity.", { body: { type: "object", additionalProperties: true } }, ["body"]),
    tool("pipedrive_connect_me", "Report Pipedrive facade connection status.", {}),
    tool("pipedrive_v1_getDealFields", "Return Pipedrive deal fields.", {}),
    tool("pipedrive_v1_getStages", "Return Pipedrive stages.", {
      pipeline_id: { type: "integer" }
    }),
    tool("pipedrive_v1_getUsers", "Return Pipedrive users.", {}),
    tool("pipedrive_v1_downloadFile", "Download a Pipedrive file.", {
      id: { type: "integer" }
    }, ["id"])
  ];
}

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false
    }
  };
}

function mergeTools(upstreamTools: Array<Record<string, unknown>>, facade: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const names = new Set(upstreamTools.map((toolEntry) => String(toolEntry.name)));
  return [
    ...upstreamTools,
    ...facade.filter((toolEntry) => !names.has(String(toolEntry.name)))
  ];
}

async function callFacadeTool(
  toolName: string,
  args: Record<string, unknown>,
  config: PipedriveFacadeConfig,
  fetchImpl: FetchLike
) {
  switch (toolName) {
    case "pipedrive_pipeline_shape": {
      const [pipelines, stages] = await Promise.all([
        requestPipedrive({ method: "GET", path: "/v1/pipelines" }, config, fetchImpl),
        requestPipedrive({ method: "GET", path: "/v1/stages" }, config, fetchImpl)
      ]);
      const data = {
        pipelines: responseDataArray(pipelines.data),
        stages: responseDataArray(stages.data)
      };
      return toolResult(`Returned ${data.pipelines.length} Pipedrive pipelines.`, data);
    }
    case "pipedrive_api_request": {
      const method = requireString(args.method, "method").toUpperCase();
      const path = requireString(args.path, "path");
      const response = await requestPipedrive({
        method,
        path,
        query: objectArg(args.query),
        body: args.body
      }, config, fetchImpl);
      return toolResult(
        `Pipedrive ${method} ${path} returned status ${response.status}.`,
        response,
        response.status === "write_disabled"
      );
    }
    case "pipedrive_search":
      return apiTool("GET", "/v1/itemSearch", {
        term: requireString(args.term, "term"),
        item_types: arrayArg(args.itemTypes)?.join(","),
        fields: arrayArg(args.fields)?.join(","),
        exact_match: args.exactMatch,
        limit: args.limit
      }, config, fetchImpl);
    case "pipedrive_search_deals":
      return apiTool("GET", "/v1/deals/search", {
        term: requireString(args.term, "term"),
        fields: arrayArg(args.fields)?.join(","),
        exact_match: args.exactMatch,
        status: args.status,
        limit: args.limit
      }, config, fetchImpl);
    case "pipedrive_get_deal":
      return apiTool("GET", `/v1/deals/${requirePositiveInteger(args.id, "id")}`, {}, config, fetchImpl);
    case "pipedrive_list_deals":
      return apiTool("GET", "/v1/deals", objectArg(args), config, fetchImpl);
    case "pipedrive_create_person":
      return apiTool("POST", "/v1/persons", {}, config, fetchImpl, requireBody(args));
    case "pipedrive_create_organization":
      return apiTool("POST", "/v1/organizations", {}, config, fetchImpl, requireBody(args));
    case "pipedrive_create_deal":
      return apiTool("POST", "/v1/deals", {}, config, fetchImpl, requireBody(args));
    case "pipedrive_update_deal":
      return apiTool("PUT", `/v1/deals/${requirePositiveInteger(args.id, "id")}`, {}, config, fetchImpl, requireBody(args));
    case "pipedrive_create_activity":
      return apiTool("POST", "/v1/activities", {}, config, fetchImpl, requireBody(args));
    case "pipedrive_connect_me":
      return toolResult("Pipedrive facade is configured with a gateway-managed API token.", {
        status: "ready",
        nextAction: "continue",
        pipedrive: {
          connected: true,
          accessMode: config.allowWrites ? "unrestricted" : "read-only"
        }
      });
    case "pipedrive_v1_getDealFields":
      return apiTool("GET", "/v1/dealFields", objectArg(args), config, fetchImpl);
    case "pipedrive_v1_getStages":
      return apiTool("GET", "/v1/stages", objectArg(args), config, fetchImpl);
    case "pipedrive_v1_getUsers":
      return apiTool("GET", "/v1/users", objectArg(args), config, fetchImpl);
    case "pipedrive_v1_downloadFile":
      return apiTool("GET", `/v1/files/${requirePositiveInteger(args.id, "id")}/download`, {}, config, fetchImpl);
    default:
      return undefined;
  }
}

async function apiTool(
  method: string,
  path: string,
  query: Record<string, unknown>,
  config: PipedriveFacadeConfig,
  fetchImpl: FetchLike,
  body?: unknown
) {
  const response = await requestPipedrive({ method, path, query, body }, config, fetchImpl);
  return toolResult(
    `Pipedrive ${method} ${path} returned status ${response.status}.`,
    response,
    response.status === "write_disabled"
  );
}

async function requestPipedrive(
  input: {
    method: string;
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
  },
  config: PipedriveFacadeConfig,
  fetchImpl: FetchLike
) {
  const method = input.method.toUpperCase();
  if (!READ_METHODS.has(method) && !WRITE_METHODS.has(method)) {
    throw new Error(`Unsupported Pipedrive method: ${method}`);
  }
  if (WRITE_METHODS.has(method) && !config.allowWrites) {
    return {
      status: "write_disabled",
      method,
      path: input.path
    };
  }

  const url = pipedriveUrl(config, input.path, input.query);
  const init: RequestInit = { method };
  if (input.body !== undefined && method !== "GET") {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(input.body);
  }
  const response = await fetchImpl(url.toString(), init);
  const data = await parseResponse(response);
  return {
    status: response.status,
    method,
    path: input.path,
    data
  };
}

function pipedriveUrl(config: PipedriveFacadeConfig, path: string, query?: Record<string, unknown>): URL {
  const domain = normalizeCompanyDomain(requireStringValue(config.companyDomain, "companyDomain"));
  const normalizedPath = normalizePipedrivePath(path);
  const url = new URL(normalizedPath, `${domain}/api/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    appendQueryValue(url, key, value);
  }
  url.searchParams.set("api_token", requireStringValue(config.apiToken, "apiToken"));
  return url;
}

function normalizeCompanyDomain(input: string): string {
  const value = input.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(value)) return value;
  if (value.includes(".")) return `https://${value}`;
  return `https://${value}.pipedrive.com`;
}

function normalizePipedrivePath(path: string): string {
  if (!path.startsWith("/")) throw new Error("Pipedrive path must start with /.");
  if (path.startsWith("/api/v")) return path.slice("/api/".length);
  if (path.startsWith("/v")) return path.slice(1);
  throw new Error("Pipedrive path must start with /v1, /v2, /api/v1, or /api/v2.");
}

function appendQueryValue(url: URL, key: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(url, key, item);
    return;
  }
  url.searchParams.append(key, String(value));
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function toolResult(text: string, structuredContent: unknown, isError = false) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
    isError
  };
}

function requireString(input: unknown, field: string): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return input.trim();
}

function requireStringValue(input: unknown, field: string): string {
  return requireString(input, field);
}

function requirePositiveInteger(input: unknown, field: string): number {
  if (typeof input !== "number" || !Number.isInteger(input) || input <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return input;
}

function requireBody(args: Record<string, unknown>): unknown {
  if (!args.body || typeof args.body !== "object" || Array.isArray(args.body)) {
    throw new Error("body must be an object.");
  }
  return args.body;
}

function objectArg(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function arrayArg(input: unknown): unknown[] | undefined {
  return Array.isArray(input) ? input : undefined;
}

function responseDataArray(input: unknown): unknown[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const data = (input as { data?: unknown }).data;
  return Array.isArray(data) ? data : [];
}
