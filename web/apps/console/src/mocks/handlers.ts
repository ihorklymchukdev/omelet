import { http, HttpResponse } from "msw";

export const SCENARIOS = ["ok", "expired", "handoff-spent", "old-agent", "down", "lost-mid-use"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export function scenarioFrom(search: string): Scenario {
  const wanted = new URLSearchParams(search).get("scenario");
  return SCENARIOS.find((scenario) => scenario === wanted) ?? "ok";
}

const PROJECTS = ["recipe-box", "weekend-shop", "tiny-crm", "photo-sorter"].map((id) => ({ id, status: "running" }));

// Same codes and wording as the agent's own refusals.
const refuse = (code: string, message: string, status: number) =>
  HttpResponse.json({ error: { code, message } }, { status });
const notSignedIn = () => refuse("not_signed_in", "open Omelet from the desktop app to sign in", 401);
const expired = () => refuse("session_expired", "your sign-in ran out; open Omelet from the desktop app again", 401);

export function handlersFor(scenario: Scenario) {
  let signedIn = scenario === "ok" || scenario === "old-agent" || scenario === "lost-mid-use";

  return [
    http.get("/api/health", () =>
      scenario === "down"
        ? HttpResponse.error()
        : HttpResponse.json({
            status: "ok",
            version: "0.2.0",
            api: scenario === "old-agent" ? 2 : 1,
            docker: { reachable: true, version: "29.0.0", detail: "" },
          }),
    ),
    http.post("/api/session", () => {
      if (scenario === "handoff-spent") {
        return refuse("handoff_invalid", "that sign-in link has already been used or has run out; open Omelet from the desktop app again", 401);
      }
      signedIn = true;
      return HttpResponse.json({ signed_in: true });
    }),
    http.get("/api/session", () => {
      if (signedIn) return HttpResponse.json({ signed_in: true });
      return scenario === "expired" ? expired() : notSignedIn();
    }),
    http.delete("/api/session", () => {
      signedIn = false;
      return HttpResponse.json({ signed_in: false });
    }),
    http.get("/api/projects", () => {
      if (scenario === "lost-mid-use") return expired();
      if (!signedIn) return notSignedIn();
      return HttpResponse.json({ projects: PROJECTS, discovered: [] });
    }),
  ];
}
