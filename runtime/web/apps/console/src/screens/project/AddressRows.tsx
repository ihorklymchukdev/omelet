import { cx } from "@omelet/ui";
import { CopyButton } from "../../components/CopyButton";
import { hostOf } from "../../projects/format";
import type { WebEntry } from "../../projects/types";
import s from "./ProjectPage.module.css";

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
