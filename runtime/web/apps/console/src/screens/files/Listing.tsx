import { Link } from "react-router";
import { relativeTime, size } from "../../projects/format";
import type { DirEntry } from "../../uploads/queries";
import { fileUrl, filesRoute, joinPath } from "../../uploads/paths";
import { FOLDER } from "../icons";
import s from "./FilesPage.module.css";

export function Listing({ projectId, dir, entries, now }: { projectId: string; dir: string; entries: DirEntry[]; now: number }) {
  return (
    <ul className={s.rows}>
      <li className={s.headRow} aria-hidden="true">
        <span>Name</span>
        <span>Size</span>
        <span>Changed</span>
      </li>
      {entries.map((entry) => {
        const path = joinPath(dir, entry.name);
        const detail = entry.kind === "folder" ? (entry.items === null ? "—" : `${entry.items} ${entry.items === 1 ? "item" : "items"}`) : size(entry.size ?? 0);
        return (
          <li key={entry.name} className={s.row}>
            {entry.kind === "folder" ? (
              <Link to={filesRoute(projectId, path)} className={s.entry}>{FOLDER}{entry.name}</Link>
            ) : (
              <a href={fileUrl(projectId, path)} download={entry.name} className={s.entry}>{entry.name}</a>
            )}
            <span className={s.meta}>{detail}</span>
            <span className={s.meta}>{relativeTime(entry.modified, now)}</span>
          </li>
        );
      })}
    </ul>
  );
}
