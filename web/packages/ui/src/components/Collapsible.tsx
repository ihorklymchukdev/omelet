import type { ReactNode } from "react";
import { cx } from "../cx";
import s from "./Collapsible.module.css";

export function Collapsible({
  summary,
  aside,
  boxed = false,
  defaultOpen = false,
  onToggle,
  children,
}: {
  summary: ReactNode;
  aside?: ReactNode;
  boxed?: boolean;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details className={cx(s.details, boxed && s.boxed)} open={defaultOpen || undefined} onToggle={onToggle && ((event) => onToggle(event.currentTarget.open))}>
      <summary className={s.summary}>
        {summary}
        <svg className={s.chevron} width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="m2.5 3.8 2.5 2.5 2.5-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {aside && <span className={s.aside}>{aside}</span>}
      </summary>
      <div className={s.body}>{children}</div>
    </details>
  );
}
