import { describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { actorContext, bearerAuth } from "../src/auth.js";

function makeReq(headers: Record<string, string> = {}): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()]
  } as unknown as Request;
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("bearerAuth", () => {
  it("rejects when the bearer secret is too short", () => {
    expect(() => bearerAuth("too-short")).toThrow(/at least 16/);
  });

  it("rejects missing or malformed Authorization", () => {
    const mw = bearerAuth("a_secret_thats_long_enough");
    const res = makeRes();
    const next = vi.fn<NextFunction>();
    mw(makeReq(), res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an incorrect bearer", () => {
    const mw = bearerAuth("a_secret_thats_long_enough");
    const res = makeRes();
    const next = vi.fn<NextFunction>();
    mw(makeReq({ authorization: "Bearer some_wrong_token" }), res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() on a matching bearer", () => {
    const mw = bearerAuth("a_secret_thats_long_enough");
    const res = makeRes();
    const next = vi.fn<NextFunction>();
    mw(makeReq({ authorization: "Bearer a_secret_thats_long_enough" }), res, next);
    expect(res.statusCode).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("actorContext", () => {
  it("falls back to the default user_id when the header is missing", () => {
    const mw = actorContext("genvest");
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn<NextFunction>();
    mw(req, res, next);
    expect((req as Request).actor?.userId).toBe("genvest");
    expect(next).toHaveBeenCalledOnce();
  });

  it("uses the X-Composio-User-Id header when present", () => {
    const mw = actorContext("genvest");
    const req = makeReq({ "x-composio-user-id": "genvest-head-of-sales" });
    const res = makeRes();
    const next = vi.fn<NextFunction>();
    mw(req, res, next);
    expect((req as Request).actor?.userId).toBe("genvest-head-of-sales");
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects malformed user_id headers", () => {
    const mw = actorContext("genvest");
    const req = makeReq({ "x-composio-user-id": "bad value with spaces" });
    const res = makeRes();
    const next = vi.fn<NextFunction>();
    mw(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});
