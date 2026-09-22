import { delay, http, HttpResponse } from "msw";
import { slugify } from "../projects/slugify";
import type { Discovered, Job, JobKind, Project } from "../projects/types";

export const SCENARIOS = [
  "ok",
  "empty",
  "expired",
  "handoff-spent",
  "old-agent",
  "down",
  "lost-mid-use",
  "wrong-host",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export function scenarioFrom(search: string): Scenario {
  const wanted = new URLSearchParams(search).get("scenario");
  return SCENARIOS.find((scenario) => scenario === wanted) ?? "ok";
}

const DOMAIN = "127-0-0-1.sslip.io";
const address = (id: string, sub?: string) => `http://${sub ? `${sub}.` : ""}${id}.${DOMAIN}:39080`;
const nowSec = () => Date.now() / 1000;

const LOOPBACK = { code: "bound_to_loopback", message: "the web service listens on 127.0.0.1 inside its container" };
const NO_COMPOSE = { code: "compose_missing", message: "there's no docker-compose.yml in this project yet" };

function project(id: string, over: Partial<Project> = {}): Project {
  return {
    id,
    status: "stopped",
    domain: DOMAIN,
    path: `/opt/omelet/projects/${id}`,
    urls: [address(id)],
    problem: null,
    empty: false,
    web: [{ url: address(id), service: "web", primary: true }],
    first_run: false,
    job: null,
    ...over,
  };
}

function emptyProject(id: string): Project {
  return project(id, { urls: [], web: [], empty: true, problem: NO_COMPOSE, first_run: true });
}

const LOGS = `11:04:19 photo-sorter_web  listening on 127.0.0.1:8000
11:04:22 proxy  GET / → ECONNREFUSED 172.19.0.4:8000
11:04:27 proxy  health check failed 3/3
`;

// Same codes and wording as the agent's own refusals.
const refuse = (code: string, message: string, status: number) =>
  HttpResponse.json({ error: { code, message } }, { status });
const notSignedIn = () => refuse("not_signed_in", "open Omelet from the desktop app to sign in", 401);
const expired = () => refuse("session_expired", "your sign-in ran out; open Omelet from the desktop app again", 401);
const notFound = (id: string) => refuse("project_not_found", `no project called ${id}`, 404);
const busy = () => refuse("project_busy", "this project is busy with another job", 409);

export function handlersFor(scenario: Scenario) {
  let signedIn = scenario === "ok" || scenario === "empty" || scenario === "old-agent" || scenario === "lost-mid-use";
  const projects = new Map<string, Project>();
  const discovered: Discovered[] = [];
  const jobs = new Map<string, Job>();

  function startJob(target: Project, kind: JobKind): Job {
    const id = Math.random().toString(16).slice(2, 14);
    const steps = kind === "down" ? ["preparing", "stopping"] : ["preparing", "starting", "checking"];
    const stepMs = target.first_run && kind !== "down" ? 6000 : 2000;
    const job: Job = {
      job_id: id,
      kind,
      phase: steps[0],
      state: "running",
      detail: "",
      result: null,
      started_at: nowSec(),
      finished_at: null,
    };
    jobs.set(id, job);
    target.job = { id, kind, phase: steps[0], started_at: job.started_at };
    let step = 0;
    const tick = () => {
      step += 1;
      if (step < steps.length) {
        job.phase = steps[step];
        if (target.job) target.job = { ...target.job, phase: job.phase };
        window.setTimeout(tick, stepMs);
        return;
      }
      target.job = null;
      job.finished_at = nowSec();
      if (kind === "down") {
        target.status = "stopped";
        job.state = "done";
        job.result = { status: "stopped" };
        return;
      }
      target.first_run = false;
      target.status = "started_ok";
      // photo-sorter never gets better, so "Try again" can be walked.
      target.problem = target.id === "photo-sorter" ? LOOPBACK : null;
      // started_ok with a diagnosed problem still finishes the job as done,
      // same as the real agent; the problem lives on the project, in result.
      job.state = "done";
      job.detail = "";
      job.result = { status: target.status, urls: target.urls, problem: target.problem };
    };
    window.setTimeout(tick, stepMs);
    return job;
  }

  if (scenario !== "empty") {
    const minutesAgo = (n: number) => nowSec() - n * 60;
    for (const p of [
      project("recipe-box", {
        status: "started_ok",
        urls: [address("recipe-box"), address("recipe-box", "api"), address("recipe-box", "studio")],
        web: [
          { url: address("recipe-box"), service: "web", primary: true },
          { url: address("recipe-box", "api"), service: "api", primary: false },
          { url: address("recipe-box", "studio"), service: "studio", primary: false },
        ],
      }),
      project("weekend-shop"),
      project("tiny-crm", { first_run: true }),
      project("photo-sorter", { status: "started_ok", problem: LOOPBACK }),
      emptyProject("notes-app"),
      project("old-blog", { urls: [], web: [], problem: { code: "folder_missing", message: "this project's folder is gone" } }),
    ]) {
      projects.set(p.id, p);
    }
    startJob(projects.get("tiny-crm")!, "up");
    discovered.push(
      { name: "invoice-helper", seen_at: minutesAgo(4), adoptable: true, reason: null },
      { name: "spice-rack", seen_at: minutesAgo(20), adoptable: false, reason: "compose_missing" },
      { name: "Tax Stuff", seen_at: minutesAgo(130), adoptable: false, reason: "bad_name" },
    );
  }

  const guard = () => (signedIn ? null : notSignedIn());
  const find = (id: string) => projects.get(id) ?? null;

  const lifecycle = (action: "up" | "down" | "restart") =>
    http.post(`/api/projects/:id/${action}`, ({ params }) => {
      const denied = guard();
      if (denied) return denied;
      const target = find(String(params.id));
      if (!target) return notFound(String(params.id));
      if (target.job) return busy();
      if (action !== "down" && target.empty) return refuse(NO_COMPOSE.code, NO_COMPOSE.message, 400);
      return HttpResponse.json({ job_id: startJob(target, action).job_id }, { status: 202 });
    });

  return [
    http.get("/api/health", () => {
      if (scenario === "down") return HttpResponse.error();
      if (scenario === "wrong-host") return refuse("forbidden_host", "this address isn't allowed", 403);
      return HttpResponse.json({
        status: "ok",
        version: "0.2.0",
        api: scenario === "old-agent" ? 2 : 1,
        docker: { reachable: true, version: "29.0.0", detail: "" },
      });
    }),
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

    http.get("/api/projects", async () => {
      if (scenario === "lost-mid-use") return expired();
      const denied = guard();
      if (denied) return denied;
      await delay(200);
      return HttpResponse.json({ projects: [...projects.values()], discovered });
    }),
    http.post("/api/projects", async ({ request }) => {
      const denied = guard();
      if (denied) return denied;
      const { id: raw } = (await request.json()) as { id: string };
      const id = slugify(raw);
      if (!id) return refuse("invalid_project", "a project needs a name made of letters, numbers or dashes", 422);
      if (projects.has(id)) return refuse("project_exists", `a project called ${id} already exists`, 409);
      const created = emptyProject(id);
      projects.set(id, created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.get("/api/projects/:id", ({ params }) => {
      const denied = guard();
      if (denied) return denied;
      const target = find(String(params.id));
      return target ? HttpResponse.json(target) : notFound(String(params.id));
    }),
    http.post("/api/projects/:id/adopt", ({ params }) => {
      const denied = guard();
      if (denied) return denied;
      const name = String(params.id);
      const index = discovered.findIndex((folder) => folder.name === name);
      if (projects.has(name)) return refuse("project_exists", `a project called ${name} already exists`, 409);
      if (index === -1) return refuse("folder_not_found", `there's no folder called ${name}`, 404);
      if (!discovered[index].adoptable) return refuse("not_adoptable", `${name} can't be adopted yet`, 409);
      discovered.splice(index, 1);
      const adopted = project(name, { first_run: true });
      projects.set(name, adopted);
      return HttpResponse.json(adopted, { status: 201 });
    }),
    lifecycle("up"),
    lifecycle("down"),
    lifecycle("restart"),
    http.get("/api/jobs/:id", ({ params }) => {
      const denied = guard();
      if (denied) return denied;
      const job = jobs.get(String(params.id));
      return job ? HttpResponse.json(job) : refuse("job_not_found", "no such job", 404);
    }),
    http.get("/api/projects/:id/logs", async ({ params }) => {
      const denied = guard();
      if (denied) return denied;
      const target = find(String(params.id));
      if (!target) return notFound(String(params.id));
      await delay(300);
      if (target.empty) return refuse("logs_unavailable", "there are no logs for this project yet", 409);
      const text = target.id === "photo-sorter" ? LOGS : `${target.id}_web  ready\n`;
      return new HttpResponse(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }),
    http.get("/api/projects/:id/delete-preview", async ({ params }) => {
      const denied = guard();
      if (denied) return denied;
      const target = find(String(params.id));
      if (!target) return notFound(String(params.id));
      await delay(400);
      if (target.empty) return HttpResponse.json({ files: 0, bytes: 0, containers: [], volumes: [] });
      return HttpResponse.json({
        files: 412,
        bytes: 38 * 1024 * 1024,
        containers: [`${target.id}-web-1`, `${target.id}-db-1`],
        volumes: [`${target.id}_db-data`],
      });
    }),
    http.delete("/api/projects/:id", ({ params }) => {
      const denied = guard();
      if (denied) return denied;
      const target = find(String(params.id));
      if (!target) return notFound(String(params.id));
      if (target.job) return busy();
      projects.delete(target.id);
      // photo-sorter shows the "may still be running" outcome.
      const stopped = target.id !== "photo-sorter";
      return HttpResponse.json({ id: target.id, stopped, detail: stopped ? "" : "a container didn't stop in time" });
    }),
  ];
}
