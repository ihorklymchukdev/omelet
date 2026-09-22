import { useQuery } from "@tanstack/react-query";
import { RowCard } from "@omelet/ui";
import { api } from "../api/client";
import s from "./Projects.module.css";

interface ProjectList {
  projects: { id: string }[];
}

export function Projects() {
  const query = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<ProjectList>("/api/projects"),
  });

  return (
    <section className={s.page}>
      <h1 className={s.title}>Your projects</h1>
      {query.isPending ? (
        <p className={s.muted}>Checking the kitchen…</p>
      ) : query.isError ? (
        <p className={s.error}>{query.error.message}</p>
      ) : query.data.projects.length === 0 ? (
        <p className={s.muted}>Nothing here yet.</p>
      ) : (
        <ul className={s.list}>
          {query.data.projects.map((project) => (
            <li key={project.id}>
              <RowCard><span className={s.name}>{project.id}</span></RowCard>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
