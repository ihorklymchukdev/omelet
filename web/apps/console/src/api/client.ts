export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type SessionLoss = "not_signed_in" | "session_expired";

export function isSessionLost(error: unknown): error is ApiError & { code: SessionLoss } {
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    (error.code === "not_signed_in" || error.code === "session_expired")
  );
}

export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  text(path: string): Promise<string>;
}

function agentError(body: unknown): { code: string; message: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === "string" && typeof message === "string" ? { code, message } : null;
}

function parse(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function createApi(fetchImpl: typeof fetch, { timeoutMs = 10_000 }: { timeoutMs?: number } = {}): Api {
  async function send(method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
    let response: Response;
    try {
      // Origin is left to the browser: the agent refuses a non-GET without it.
      // A hung agent must not hang the page: an aborted fetch rejects and
      // falls into the same "unreachable" mapping below as a refused one.
      response = await fetchImpl(path, {
        method,
        credentials: "same-origin",
        signal: AbortSignal.timeout(timeoutMs),
        ...(body === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError("unreachable", "Omelet's service isn't answering", 0);
    }
    const text = await response.text();
    if (!response.ok) {
      const parsed = parse(text);
      const error = parsed.ok ? agentError(parsed.value) : null;
      if (error) throw new ApiError(error.code, error.message, response.status);
      throw new ApiError("unexpected", `unexpected answer (${response.status})`, response.status);
    }
    return { status: response.status, text };
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { status, text } = await send(method, path, body);
    const parsed = parse(text);
    if (!parsed.ok) throw new ApiError("unexpected", "the answer wasn't JSON", status);
    return parsed.value as T;
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    del: (path) => request("DELETE", path),
    text: async (path) => (await send("GET", path)).text,
  };
}

export const api = createApi((input, init) => fetch(input, init));

export function signOut(): Promise<unknown> {
  return api.del("/api/session");
}
