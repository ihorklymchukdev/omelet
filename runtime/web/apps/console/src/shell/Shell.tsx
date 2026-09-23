import type { ReactNode } from "react";
import { Egg, cx } from "@omelet/ui";
import s from "./Shell.module.css";

export function Shell({
  tone = "yolk",
  trailing,
  children,
}: {
  tone?: "yolk" | "cold";
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={s.page}>
      <header className={cx(s.bar, tone === "cold" && s.muted)}>
        <Egg tone={tone} size={22} />
        <span className={s.brand}>Omelet</span>
        {trailing && <div className={s.trailing}>{trailing}</div>}
      </header>
      <main className={s.content}>{children}</main>
    </div>
  );
}
