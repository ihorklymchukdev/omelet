import type { ReactNode } from "react";
import { cx } from "../cx";
import s from "./Notice.module.css";

const INFO = (
  <svg className={s.icon} width="15" height="15" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.4" />
    <path d="M9 8.2v4M9 5.6v.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const FOLDER = (
  <svg className={s.icon} width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M2.5 5.2A1.5 1.5 0 0 1 4 3.7h3l1.4 1.8H14A1.5 1.5 0 0 1 15.5 7v6.2A1.5 1.5 0 0 1 14 14.7H4a1.5 1.5 0 0 1-1.5-1.5V5.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

export function Notice({
  icon = "info",
  className,
  children,
}: {
  icon?: "info" | "folder";
  className?: string;
  children: ReactNode;
}) {
  return (
    <p className={cx(s.notice, className)}>
      {icon === "folder" ? FOLDER : INFO}
      <span>{children}</span>
    </p>
  );
}
