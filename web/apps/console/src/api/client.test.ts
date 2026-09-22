import { describe, expect, it } from "vitest";
import { ApiError, createApi, isSessionLost } from "./client";

function answering(status: number, body: string | null) {
  const seen: RequestInit[] = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init ?? {});
    return new Response(body, { status });
  }) as typeof fetch;
  return { api: createApi(fetchImpl), seen };
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the request to fail");
}

describe("the API client", () => {
  it("turns the agent's error body into an ApiError with its code and status", async () => {
    const { api } = answering(409, JSON.stringify({ error: { code: "project_busy", message: "busy" } }));
    const error = await failure(api.get("/api/projects"));
    expect([error.code, error.message, error.status]).toEqual(["project_busy", "busy", 409]);
  });

  it("calls an error in any other shape 'unexpected' and keeps the status", async () => {
    // Traefik answers 502 with an HTML page when the agent is down.
    const { api } = answering(502, "<html>Bad Gateway</html>");
    const error = await failure(api.get("/api/health"));
    expect([error.code, error.status]).toEqual(["unexpected", 502]);
  });

  it("refuses a 2xx answer that isn't JSON", async () => {
    // What /api/health returns if the page's catch-all route swallows /api.
    const { api } = answering(200, "<!doctype html><div id=root></div>");
    const error = await failure(api.get("/api/health"));
    expect(error.code).toBe("unexpected");
  });

  it("reports a refused connection as 'unreachable' with status 0", async () => {
    const api = createApi((async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch);
    const error = await failure(api.get("/api/health"));
    expect([error.code, error.status]).toEqual(["unreachable", 0]);
  });

  it(
    "gives up on a hung fetch instead of leaving the request pending forever",
    async () => {
      const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        })) as typeof fetch;
      const api = createApi(fetchImpl, { timeoutMs: 20 });
      const error = await failure(api.get("/api/health"));
      expect([error.code, error.status]).toEqual(["unreachable", 0]);
    },
    1000,
  );

  it("sends the session cookie and a JSON body on POST", async () => {
    const { api, seen } = answering(200, JSON.stringify({ signed_in: true }));
    await api.post("/api/session", { code: "abc" });
    expect(seen[0]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "abc" }),
    });
  });

  it("recognises only the two 401s that mean the session is gone", () => {
    expect(isSessionLost(new ApiError("session_expired", "", 401))).toBe(true);
    expect(isSessionLost(new ApiError("not_signed_in", "", 401))).toBe(true);
    expect(isSessionLost(new ApiError("handoff_invalid", "", 401))).toBe(false);
    expect(isSessionLost(new ApiError("forbidden_origin", "", 403))).toBe(false);
  });
});
