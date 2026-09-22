export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
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
  patch<T>(path: string, body: Blob, headers: Record<string, string>, signal?: AbortSignal): Promise<T>;
  del<T>(path: string): Promise<T>;
  text(path: string): Promise<string>;
}

interface AgentError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

function agentError(body: unknown): AgentError | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const { code, message, ...details } = error as Record<string, unknown>;
  return typeof code === "string" && typeof message === "string" ? { code, message, details } : null;
}

function parse(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

interface Payload {
  json?: unknown;
  raw?: Blob;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export function createApi(fetchImpl: typeof fetch, { timeoutMs = 10_000 }: { timeoutMs?: number } = {}): Api {
  async function send(method: string, path: string, payload: Payload = {}): Promise<{ status: number; text: string }> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = payload.signal ? AbortSignal.any([payload.signal, timeout]) : timeout;
    const headers: Record<string, string> = {
      ...(payload.json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(payload.raw !== undefined ? { "Content-Type": "application/octet-stream" } : {}),
      ...payload.headers,
    };
    const body = payload.json !== undefined ? JSON.stringify(payload.json) : payload.raw;
    let status: number;
    let ok: boolean;
    let text: string;
    try {
      // Origin is left to the browser: the agent refuses a non-GET without it.
      // A hung agent must not hang the page: an aborted fetch rejects and
      // falls into the same "unreachable" mapping below as a refused one.
      const response = await fetchImpl(path, {
        method,
        credentials: "same-origin",
        signal,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(body !== undefined ? { body } : {}),
      });
      status = response.status;
      ok = response.ok;
      text = await response.text();
    } catch {
      // The caller's own abort (a paused upload) is not a dropped connection.
      if (payload.signal?.aborted) throw new ApiError("aborted", "the request was cancelled", 0);
      throw new ApiError("unreachable", "Omelet's service isn't answering", 0);
    }
    if (!ok) {
      const parsed = parse(text);
      const error = parsed.ok ? agentError(parsed.value) : null;
      if (error) throw new ApiError(error.code, error.message, status, error.details);
      throw new ApiError("unexpected", `unexpected answer (${status})`, status);
    }
    return { status, text };
  }

  async function request<T>(method: string, path: string, payload?: Payload): Promise<T> {
    const { status, text } = await send(method, path, payload);
    const parsed = parse(text);
    if (!parsed.ok) throw new ApiError("unexpected", "the answer wasn't JSON", status);
    return parsed.value as T;
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body === undefined ? {} : { json: body }),
    patch: (path, body, headers, signal) => request("PATCH", path, { raw: body, headers, signal }),
    del: (path) => request("DELETE", path),
    text: async (path) => (await send("GET", path)).text,
  };
}

export const api = createApi((input, init) => fetch(input, init));

export function signOut(): Promise<unknown> {
  return api.del("/api/session");
}
