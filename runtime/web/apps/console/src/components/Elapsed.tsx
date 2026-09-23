import { elapsed } from "../projects/format";
import { useNow } from "../projects/useNow";

export function Elapsed({ startedAt }: { startedAt: number }) {
  const now = useNow();
  return <>{elapsed(startedAt, now)}</>;
}
