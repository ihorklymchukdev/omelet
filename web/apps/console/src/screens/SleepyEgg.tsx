import s from "./SleepyEgg.module.css";

export function SleepyEgg() {
  return (
    <div className={s.art} aria-hidden="true">
      <div className={s.plate} />
      <div className={s.white} />
      <div className={s.yolk} />
      <div className={s.mouth} />
      <span className={s.z1}>z</span>
      <span className={s.z2}>z</span>
    </div>
  );
}
