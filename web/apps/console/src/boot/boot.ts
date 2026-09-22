import { ApiError, createApi, isSessionLost } from "../api/client";
import { SUPPORTED_API } from "../api/version";

export type SignedOutReason = "not_signed_in" | "session_expired" | "handoff_spent";

export type BootResult =
  | { kind: "signedIn" }
  | { kind: "signedOut"; reason: SignedOutReason }
  | { kind: "needsUpdate"; agentApi: number | null }
  | { kind: "notAnswering" }
  | { kind: "wrongHost" };

function isWrongHost(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    (error.code === "forbidden_host" || error.code === "forbidden_origin")
  );
}

export function takeHandoff(
  location: Pick<Location, "hash" | "pathname" | "search">,
  history: Pick<History, "replaceState">,
): string | null {
  const code = new URLSearchParams(location.hash.replace(/^#/, "")).get("handoff");
  if (!code) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return code;
}

export async function boot({
  fetch,
  handoff,
}: {
  fetch: typeof globalThis.fetch;
  handoff: string | null;
}): Promise<BootResult> {
  const api = createApi(fetch);

  let health: { api?: unknown } | undefined;
  try {
    health = await api.get<{ api?: unknown }>("/api/health");
  } catch (error) {
    return isWrongHost(error) ? { kind: "wrongHost" } : { kind: "notAnswering" };
  }
  const agentApi = typeof health?.api === "number" ? health.api : null;
  if (agentApi === null || !SUPPORTED_API.includes(agentApi)) {
    return { kind: "needsUpdate", agentApi };
  }

  let spent = false;
  if (handoff !== null) {
    try {
      await api.post("/api/session", { code: handoff });
      return { kind: "signedIn" };
    } catch (error) {
      if (isWrongHost(error)) return { kind: "wrongHost" };
      if (!(error instanceof ApiError && error.code === "handoff_invalid")) {
        return { kind: "notAnswering" };
      }
      // An older cookie may still be good; only its absence makes this an error.
      spent = true;
    }
  }

  try {
    await api.get("/api/session");
    return { kind: "signedIn" };
  } catch (error) {
    if (isSessionLost(error)) {
      return { kind: "signedOut", reason: spent ? "handoff_spent" : error.code };
    }
    return isWrongHost(error) ? { kind: "wrongHost" } : { kind: "notAnswering" };
  }
}
