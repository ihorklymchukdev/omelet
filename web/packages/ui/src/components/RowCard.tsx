import type { ReactNode } from "react";
import { cx } from "../cx";
import s from "./RowCard.module.css";

export function RowCard({
  accent = "plain",
  className,
  children,
}: {
  accent?: "plain" | "attention" | "trouble";
  className?: string;
  children: ReactNode;
}) {
  return <div className={cx(s.row, s[accent], className)}>{children}</div>;
}
