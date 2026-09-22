import { Link } from "react-router";
import { cx } from "@omelet/ui";
import { filesRoute } from "../../uploads/paths";
import { FOLDER, GLOBE, MAGNIFIER, TRASH } from "../icons";
import s from "./ProjectPage.module.css";

export function Tiles({ id, onAnalyze, onDelete }: { id: string; onAnalyze: () => void; onDelete: () => void }) {
  return (
    <div className={s.tiles}>
      <button type="button" className={s.tile} onClick={onAnalyze}>{MAGNIFIER}Analyze</button>
      <Link to={filesRoute(id, "")} className={s.tile}>{FOLDER}Files</Link>
      <button type="button" className={cx(s.tile, s.off)} disabled>{GLOBE}Public address<small>Needs an account</small></button>
      <button type="button" className={cx(s.tile, s.danger)} onClick={onDelete}>{TRASH}Delete</button>
    </div>
  );
}
