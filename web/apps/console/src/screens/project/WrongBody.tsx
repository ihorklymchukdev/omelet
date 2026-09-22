import { useState } from "react";
import { Button, Collapsible, Egg, Modal, Notice, PromptCard, StateBadge } from "@omelet/ui";
import { ApiError } from "../../api/client";
import { CAUSE_COPY, actionError, primaryUrl } from "../../projects/copy";
import { hostOf } from "../../projects/format";
import { fixPrompt } from "../../projects/prompts";
import { useLifecycle, useLogs } from "../../projects/queries";
import type { Project } from "../../projects/types";
import type { Cause } from "../../projects/view";
import s from "./ProjectPage.module.css";

function Logs({ id, wanted }: { id: string; wanted: boolean }) {
  const logs = useLogs(id, wanted);
  if (logs.data !== undefined) {
    return <pre className={s.logs}>{logs.data.trim() ? logs.data : "There aren't any logs to show yet."}</pre>;
  }
  if (logs.isError) {
    return (
      <p className={s.muted}>
        {logs.error instanceof ApiError && logs.error.code === "logs_unavailable"
          ? "There aren't any logs to show yet."
          : logs.error.message}
      </p>
    );
  }
  return <p className={s.muted}>Fetching the logs…</p>;
}

export function WrongBody({ project, cause, detail }: { project: Project; cause: Cause; detail: string | null }) {
  const lifecycle = useLifecycle(project.id);
  const [fixing, setFixing] = useState(false);
  const [wantLogs, setWantLogs] = useState(false);
  const copy = CAUSE_COPY[cause];
  const primary = primaryUrl(project);

  return (
    <>
      <header className={s.wrongHead}>
        <Egg tone="cold" size={56} />
        <StateBadge state="wrong" />
        <h1 className={s.big}>{copy.heading(project.id)}</h1>
      </header>
      <p className={s.lead}>{copy.body}</p>
      {detail && <p className={s.detail}>{detail}</p>}
      <div className={s.actions}>
        <Button variant="primary" disabled={lifecycle.isPending} onClick={() => lifecycle.mutate("restart")}>Try again</Button>
        <Button onClick={() => setFixing(true)}>Get a prompt that fixes it</Button>
        <span className={s.note}>Nothing is lost. Your files are exactly where you left them.</span>
      </div>
      {lifecycle.error && <Notice>{actionError(lifecycle.error)}</Notice>}
      <Collapsible
        boxed
        summary="The raw details"
        aside="for your coding agent, or for us"
        onToggle={(open) => open && setWantLogs(true)}
      >
        {wantLogs && <Logs id={project.id} wanted={wantLogs} />}
      </Collapsible>
      {primary && (
        <div className={s.was}>
          <span>Was going to be</span>
          <code>{hostOf(primary)}</code>
        </div>
      )}
      <Modal open={fixing} onClose={() => setFixing(false)} title="A prompt that fixes it">
        <PromptCard prompt={fixPrompt(cause, project.id, detail)} />
        <div className={s.modalFoot}>
          <Button onClick={() => setFixing(false)}>Close</Button>
        </div>
      </Modal>
    </>
  );
}
