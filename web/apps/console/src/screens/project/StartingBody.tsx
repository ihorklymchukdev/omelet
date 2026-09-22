import { Egg, ProgressBar, StateBadge } from "@omelet/ui";
import { Elapsed } from "../../components/Elapsed";
import { phaseCaption } from "../../projects/copy";
import { useJob } from "../../projects/queries";
import type { ActiveJob, Project } from "../../projects/types";
import s from "./ProjectPage.module.css";

export function StartingBody({ project, job }: { project: Project; job: ActiveJob }) {
  const live = useJob(job.id);
  const caption = phaseCaption(live.data?.phase ?? job.phase, project.first_run);
  return (
    <div className={s.center}>
      <Egg size={88} bob />
      <StateBadge state="starting" />
      <h1 className={s.big}>Heating the pan for {project.id}</h1>
      <p className={s.lead}>
        {project.first_run
          ? "The first start always takes the longest — it's fetching everything your app needs to run. A few minutes, once. After that it's about ten seconds."
          : "This usually takes about ten seconds."}
      </p>
      <div className={s.progress}>
        <ProgressBar label={caption} />
        <div className={s.caption}>
          <span>{caption}</span>
          <span><Elapsed startedAt={job.started_at} /> so far</span>
        </div>
      </div>
      <p className={s.footnote}>
        You can wander off — this keeps going with the page closed, and the address turns on by itself when it's ready.
      </p>
    </div>
  );
}
