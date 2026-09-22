import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Egg, Notice, PromptCard, StateBadge } from "@omelet/ui";
import { ApiError } from "../../api/client";
import { Elapsed } from "../../components/Elapsed";
import { actionError, primaryUrl } from "../../projects/copy";
import { waitingPrompt } from "../../projects/prompts";
import { useDeleteProject, useLifecycle, useProject } from "../../projects/queries";
import { projectView } from "../../projects/view";
import { ARROW } from "../icons";
import { AddressRows } from "./AddressRows";
import { AnalyzeModal } from "./AnalyzeModal";
import { DeleteModal } from "./DeleteModal";
import { StartingBody } from "./StartingBody";
import { Tiles } from "./Tiles";
import { WrongBody } from "./WrongBody";
import s from "./ProjectPage.module.css";

export function ProjectPage() {
  const { id = "" } = useParams();
  const query = useProject(id);
  const lifecycle = useLifecycle(id);
  const forget = useDeleteProject(id);
  const navigate = useNavigate();
  const [modal, setModal] = useState<"analyze" | "delete" | null>(null);

  const back = <Link to="/" className={s.back}>‹ All projects</Link>;

  if (query.data === undefined) {
    if (query.error instanceof ApiError && query.error.code === "project_not_found") {
      return (
        <section className={s.page}>
          {back}
          <h1 className={s.name}>No project called {id}</h1>
        </section>
      );
    }
    return (
      <section className={s.page}>
        {back}
        {query.isError ? <p className={s.error}>{query.error.message}</p> : <p className={s.muted}>Checking the kitchen…</p>}
      </section>
    );
  }

  const project = query.data;
  const view = projectView(project);
  const primary = primaryUrl(project);
  const tiles = <Tiles onAnalyze={() => setModal("analyze")} onDelete={() => setModal("delete")} />;
  const failed = lifecycle.error && <Notice>{actionError(lifecycle.error)}</Notice>;
  const head = (sub?: string) => (
    <header className={s.head}>
      <Egg size={44} tone={view.badge === "running" || view.badge === "starting" ? "yolk" : "cold"} />
      <div className={s.grow}>
        <h1 className={s.name}>{project.id}</h1>
        {sub && <p className={s.sub}>{sub}</p>}
      </div>
      <StateBadge state={view.badge} />
    </header>
  );

  let body: ReactNode;
  switch (view.kind) {
    case "starting":
      body = <StartingBody project={project} job={view.job} />;
      break;
    case "stopping":
      body = (
        <>
          {head()}
          <p className={s.lead}>Putting {project.id} away… <Elapsed startedAt={view.job.started_at} /></p>
        </>
      );
      break;
    case "wrong":
      body = (
        <>
          <WrongBody project={project} cause={view.cause} detail={view.detail} />
          {tiles}
        </>
      );
      break;
    case "running": {
      const count = project.web.length;
      body = (
        <>
          {head(count > 0 ? `${count} ${count === 1 ? "address" : "addresses"} open` : undefined)}
          <div className={s.actions}>
            {primary && (
              <Button variant="primary" onClick={() => window.open(primary, "_blank", "noopener,noreferrer")}>
                Open in browser{ARROW}
              </Button>
            )}
            <Button disabled={lifecycle.isPending} onClick={() => lifecycle.mutate("down")}>Stop</Button>
            <Button disabled={lifecycle.isPending} onClick={() => lifecycle.mutate("restart")}>Restart</Button>
          </div>
          {failed}
          <AddressRows web={project.web} live />
          {tiles}
        </>
      );
      break;
    }
    case "stopped":
      body = (
        <>
          {head()}
          <div className={s.actions}>
            <Button variant="primary" disabled={lifecycle.isPending} onClick={() => lifecycle.mutate("up")}>Start</Button>
          </div>
          {failed}
          <AddressRows web={project.web} live={false} />
          {tiles}
        </>
      );
      break;
    case "waiting":
      body = (
        <>
          {head("Nothing to cook yet")}
          <p className={s.lead}>
            {project.id} is an empty folder at ~/projects/{project.id}. Your coding agent fills it in; once there's a
            docker-compose.yml, Start appears here.
          </p>
          <PromptCard prompt={waitingPrompt(project.id)} />
          {tiles}
        </>
      );
      break;
    case "gone":
      body = (
        <>
          {head()}
          <h2 className={s.big}>The folder for {project.id} has gone missing</h2>
          <p className={s.lead}>Omelet still remembers it, but ~/projects/{project.id} isn't there any more.</p>
          <div className={s.actions}>
            <Button
              variant="danger"
              disabled={forget.isPending}
              onClick={() => forget.mutate(false, { onSuccess: (result) => navigate("/", { state: { deleted: result } }) })}
            >
              Forget it
            </Button>
          </div>
          {forget.error && <Notice>{actionError(forget.error)}</Notice>}
        </>
      );
      break;
  }

  return (
    <section className={s.page}>
      {back}
      {query.isError && <Notice>{query.error.message}</Notice>}
      {body}
      <AnalyzeModal open={modal === "analyze"} onClose={() => setModal(null)} />
      <DeleteModal id={project.id} open={modal === "delete"} onClose={() => setModal(null)} />
    </section>
  );
}
