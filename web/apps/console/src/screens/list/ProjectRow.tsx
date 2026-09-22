import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { Button, Notice, RowCard, StateBadge } from "@omelet/ui";
import { Elapsed } from "../../components/Elapsed";
import { CAUSE_COPY, actionError, primaryUrl } from "../../projects/copy";
import { hostOf } from "../../projects/format";
import { useLifecycle } from "../../projects/queries";
import type { Project } from "../../projects/types";
import { projectView } from "../../projects/view";
import { ARROW } from "../icons";
import s from "./ProjectList.module.css";

export function ProjectRow({ project }: { project: Project }) {
  const view = projectView(project);
  const lifecycle = useLifecycle(project.id);
  const navigate = useNavigate();
  const primary = primaryUrl(project);
  const page = `/p/${encodeURIComponent(project.id)}`;
  const look = () => navigate(page);

  let line: ReactNode = null;
  let actions: ReactNode = null;
  switch (view.kind) {
    case "running":
      line = primary && <a className={s.address} href={primary} target="_blank" rel="noopener noreferrer">{hostOf(primary)}</a>;
      actions = (
        <>
          {primary && <Button onClick={() => window.open(primary, "_blank", "noopener,noreferrer")}>Open{ARROW}</Button>}
          <Button variant="quiet" disabled={lifecycle.isPending} onClick={() => lifecycle.mutate("down")}>Stop</Button>
        </>
      );
      break;
    case "stopped":
      line = primary && <span className={s.addressMuted}>{hostOf(primary)}</span>;
      actions = <Button disabled={lifecycle.isPending} onClick={() => lifecycle.mutate("up")}>Start</Button>;
      break;
    case "starting":
      line = primary && <span className={s.addressMuted}>{hostOf(primary)}</span>;
      actions = <span className={s.quiet}><Elapsed startedAt={view.job.started_at} /> so far</span>;
      break;
    case "stopping":
      line = <span className={s.quiet}>Putting it away…</span>;
      break;
    case "wrong":
      line = <span className={s.trouble}>{CAUSE_COPY[view.cause].short}</span>;
      actions = <Button variant="danger" onClick={look}>Take a look</Button>;
      break;
    case "gone":
      line = <span className={s.trouble}>Its folder has gone missing</span>;
      actions = <Button variant="danger" onClick={look}>Take a look</Button>;
      break;
    case "waiting":
      line = <span className={s.quiet}>Waiting for your coding agent</span>;
      actions = <Button onClick={look}>Open page</Button>;
      break;
  }

  return (
    <>
      <RowCard accent={view.badge === "wrong" ? "trouble" : "plain"} className={s.row}>
        <div className={s.who}>
          <a className={s.name} href={page} onClick={(event) => { event.preventDefault(); look(); }}>{project.id}</a>
          {line}
        </div>
        <StateBadge state={view.badge} />
        <div className={s.actions}>{actions}</div>
      </RowCard>
      {lifecycle.error && <Notice>{actionError(lifecycle.error)}</Notice>}
    </>
  );
}
