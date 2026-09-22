import { cx } from "@omelet/ui";
import { FOLDER, GLOBE, MAGNIFIER, TRASH } from "../icons";
import s from "./ProjectPage.module.css";

export function Tiles({ onAnalyze, onDelete }: { onAnalyze: () => void; onDelete: () => void }) {
  return (
    <div className={s.tiles}>
      <button type="button" className={s.tile} onClick={onAnalyze}>{MAGNIFIER}Analyze</button>
      <button type="button" className={cx(s.tile, s.off)} disabled>{FOLDER}Files<small>Soon</small></button>
      <button type="button" className={cx(s.tile, s.off)} disabled>{GLOBE}Public address<small>Needs an account</small></button>
      <button type="button" className={cx(s.tile, s.danger)} onClick={onDelete}>{TRASH}Delete</button>
    </div>
  );
}
