import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Notice } from "@omelet/ui";
import { ApiError } from "../../api/client";
import { useNow } from "../../projects/useNow";
import { filesRoute, joinPath } from "../../uploads/paths";
import { useListing } from "../../uploads/queries";
import { useUploads } from "../../uploads/QueueProvider";
import { Listing } from "./Listing";
import s from "./FilesPage.module.css";

export function FilesPage() {
  const params = useParams();
  const id = params.id ?? "";
  const dir = joinPath(params["*"] ?? "");
  const listing = useListing(id, dir);
  const { queue } = useUploads(id);
  const navigate = useNavigate();
  const now = useNow();

  useEffect(() => {
    void queue.syncPending(id);
  }, [queue, id]);

  const code = listing.error instanceof ApiError ? listing.error.code : null;
  useEffect(() => {
    if (code === "folder_not_found" && dir !== "") navigate(filesRoute(id, ""), { replace: true });
  }, [code, dir, id, navigate]);

  if (code === "project_not_found") {
    return (
      <section className={s.page}>
        <Link to="/" className={s.back}>‹ All projects</Link>
        <h1 className={s.title}>No project called {id}</h1>
      </section>
    );
  }

  const segments = dir === "" ? [] : dir.split("/");
  const entries = listing.data?.entries ?? [];

  return (
    <section className={s.page}>
      <Link to={`/p/${encodeURIComponent(id)}`} className={s.back}>‹ {id}</Link>
      <header className={s.head}>
        <div className={s.grow}>
          <h1 className={s.title}>Files</h1>
          <nav className={s.crumbs} aria-label="Folder">
            <Link to={filesRoute(id, "")}>{id}</Link>
            {segments.map((segment, index) => (
              <span key={index}>
                {" / "}
                <Link to={filesRoute(id, segments.slice(0, index + 1).join("/"))}>{segment}</Link>
              </span>
            ))}
          </nav>
        </div>
      </header>
      {code === "permission_denied" ? (
        <Notice>Omelet can't look inside this folder — a program in the project owns it.</Notice>
      ) : listing.isError ? (
        <Notice>{listing.error.message}</Notice>
      ) : listing.data === undefined ? (
        <p className={s.muted}>Looking in the cupboard…</p>
      ) : (
        <>
          {entries.length > 0 && <Listing projectId={id} dir={dir} entries={entries} now={now} />}
          <p className={s.foot}>
            {entries.length > 0 && <strong>{entries.length} {entries.length === 1 ? "thing" : "things"} in here</strong>}{" "}
            Drag files in from your desktop, or use Upload to choose where they land.
          </p>
        </>
      )}
    </section>
  );
}
