import { cx } from "../cx";
import s from "./SyncMarker.module.css";

export type SyncState = "synced" | "offline";

const CLOUD = "M4.4 12.5a3 3 0 0 1-.3-6 4 4 0 0 1 7.7.6 2.7 2.7 0 0 1-.4 5.4H4.4Z";

function Icon({ state }: { state: SyncState }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={CLOUD} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      {state === "synced" ? (
        <path d="m6.2 8.6 1.4 1.4 2.5-2.7" stroke="var(--basil)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M8 7.2v2.2M8 10.9v.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function SyncMarker({ state, label }: { state: SyncState; label?: string }) {
  return (
    <span className={cx(s.marker, s[state])}>
      <Icon state={state} />
      {label ?? (state === "synced" ? "Synced · just now" : "Offline · will catch up later")}
    </span>
  );
}
