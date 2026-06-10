import { describe, expect, it, vi } from "vitest";
import {
  createPipedriveFacade,
  isPipedriveFacadeConfigured,
  pipedriveFacadeToolNames
} from "../src/pipedrive-facade.js";

const baseConfig = {
  apiToken: "pd_test_token",
  companyDomain: "https://genvestpropertyptyltd.pipedrive.com"
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("pipedrive facade", () => {
  it("is configured only when token and company domain are present", () => {
    expect(isPipedriveFacadeConfigured(baseConfig)).toBe(true);
    expect(isPipedriveFacadeConfigured({ apiToken: "", companyDomain: baseConfig.companyDomain })).toBe(false);
    expect(isPipedriveFacadeConfigured({ apiToken: baseConfig.apiToken, companyDomain: "" })).toBe(false);
  });

  it("adds deterministic pipedrive tools to tools/list without removing upstream tools", async () => {
    const facade = createPipedriveFacade(baseConfig, vi.fn() as unknown as typeof fetch);
    const response = await facade.handleJsonRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {}
    }, {
      tools: [{ name: "COMPOSIO_SEARCH_TOOLS", inputSchema: { type: "object" } }]
    });

    expect(response?.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "COMPOSIO_SEARCH_TOOLS",
      ...pipedriveFacadeToolNames
    ]);
  });

  it("returns pipeline shape using direct Pipedrive REST reads", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/api/v1/pipelines")) {
        return jsonResponse({
          success: true,
          data: [
            { id: 2, name: "Customer Onboarding" },
            { id: 3, name: "Partnerships Pipeline" },
            { id: 4, name: "Customer Success" }
          ]
        });
      }
      if (url.includes("/api/v1/stages")) {
        return jsonResponse({
          success: true,
          data: [
            { id: 10, name: "Booked", pipeline_id: 2 },
            { id: 20, name: "Practical Completion", pipeline_id: 4 }
          ]
        });
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;
    const facade = createPipedriveFacade(baseConfig, fetchImpl);

    const response = await facade.handleJsonRpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "pipedrive_pipeline_shape", arguments: {} }
    });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        structuredContent: {
          pipelines: [
            { id: 2, name: "Customer Onboarding" },
            { id: 3, name: "Partnerships Pipeline" },
            { id: 4, name: "Customer Success" }
          ],
          stages: [
            { id: 10, name: "Booked", pipeline_id: 2 },
            { id: 20, name: "Practical Completion", pipeline_id: 4 }
          ]
        }
      }
    });
    expect(String(fetchImpl.mock.calls[0][0])).toContain("api_token=");
  });

  it("passes read-only generic API requests through to Pipedrive", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      return jsonResponse({ success: true, data: [{ id: 123, title: "Example deal" }] });
    }) as unknown as typeof fetch;
    const facade = createPipedriveFacade(baseConfig, fetchImpl);

    const response = await facade.handleJsonRpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "pipedrive_api_request",
        arguments: {
          method: "GET",
          path: "/v1/deals",
          query: { limit: 1 }
        }
      }
    });

    expect(response?.result.structuredContent).toMatchObject({
      status: 200,
      data: { success: true, data: [{ id: 123, title: "Example deal" }] }
    });
  });

  it("blocks write requests unless writes are explicitly enabled", async () => {
    const facade = createPipedriveFacade(baseConfig, vi.fn() as unknown as typeof fetch);

    const response = await facade.handleJsonRpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "pipedrive_api_request",
        arguments: {
          method: "POST",
          path: "/v1/notes",
          body: { content: "draft" }
        }
      }
    });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 4,
      result: {
        isError: true,
        structuredContent: {
          status: "write_disabled"
        }
      }
    });
  });

  it("marks typed write wrappers as errors when writes are disabled", async () => {
    const facade = createPipedriveFacade(baseConfig, vi.fn() as unknown as typeof fetch);

    const response = await facade.handleJsonRpc({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "pipedrive_create_deal",
        arguments: {
          body: { title: "Example deal" }
        }
      }
    });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 5,
      result: {
        isError: true,
        structuredContent: {
          status: "write_disabled",
          method: "POST",
          path: "/v1/deals"
        }
      }
    });
  });
});
