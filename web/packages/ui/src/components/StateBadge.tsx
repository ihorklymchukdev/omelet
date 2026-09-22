import { cx } from "../cx";
import s from "./StateBadge.module.css";

export type ProjectState = "running" | "stopped" | "starting" | "wrong";

const LABEL: Record<ProjectState, string> = {
  running: "Running",
  stopped: "Stopped",
  starting: "Starting",
  wrong: "Something's wrong",
};

export function StateBadge({ state }: { state: ProjectState }) {
  return (
    <span className={cx(s.badge, s[state])}>
      <span className={state === "starting" ? s.spinner : s.dot} aria-hidden="true" />
      {LABEL[state]}
    </span>
  );
}
