import { useEffect, useState } from "react";
import { Button, cx } from "@omelet/ui";
import { hostOf } from "../../projects/format";
import type { WebEntry } from "../../projects/types";
import s from "./ProjectPage.module.css";

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "refused">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("refused");
    }
  };
  return (
    <Button variant="quiet" onClick={copy}>
      <span role="status" aria-live="polite">{state === "copied" ? "Copied" : state === "refused" ? "Couldn't copy" : "Copy"}</span>
    </Button>
  );
}

export function AddressRows({ web, live }: { web: WebEntry[]; live: boolean }) {
  if (web.length === 0) return null;
  return (
    <section>
      <h2 className={s.label}>Where to find it</h2>
      <ul className={s.addresses}>
        {web.map((entry) => (
          <li key={entry.url} className={cx(s.address, !live && s.dim)}>
            <span className={s.addressLabel}>{entry.primary ? "The app itself" : entry.service}</span>
            <span className={s.url}>{hostOf(entry.url)}</span>
            {live && <CopyButton text={entry.url} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
