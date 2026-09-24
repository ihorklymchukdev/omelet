import { Button, Egg, Notice, RowCard } from "@omelet/ui";
import { PLUS } from "../icons";
import s from "./ProjectList.module.css";

export function EmptyCounter({ onNew, onGitHub }: { onNew: () => void; onGitHub: () => void }) {
  return (
    <section className={s.empty}>
      <Egg size={72} />
      <h1 className={s.emptyTitle}>An empty counter</h1>
      <p className={s.lead}>Projects live here. Make one and your coding agent finally has somewhere to put things.</p>
      <div className={s.cards}>
        <RowCard className={s.card}>
          <h2 className={s.cardTitle}>Start from scratch</h2>
          <p className={s.cardBody}>An empty project with a name on it. Your coding agent takes it from there.</p>
          <Button variant="primary" onClick={onNew}>{PLUS}New project</Button>
        </RowCard>
        <RowCard className={s.card}>
          <h2 className={s.cardTitle}>From GitHub</h2>
          <p className={s.cardBody}>Pull in a repo you already have. Connect GitHub once and pick it.</p>
          <Button onClick={onGitHub}>Pick a repo</Button>
        </RowCard>
      </div>
      <Notice icon="folder">Already have a folder on your computer? The desktop app carries it in for you.</Notice>
    </section>
  );
}
