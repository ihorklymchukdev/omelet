import { Button, Egg } from "@omelet/ui";
import { SUPPORTED_API } from "../api/version";
import { StatusScreen } from "./StatusScreen";
import s from "./StatusScreen.module.css";

export function NeedsUpdate({ agentApi, onRetry }: { agentApi: number | null; onRetry: () => void }) {
  return (
    <StatusScreen
      tone="yolk"
      art={<Egg size={96} bob />}
      title="Omelet needs an update"
      actions={<Button variant="primary" size="lg" onClick={onRetry}>Try again</Button>}
    >
      <p className={s.lead}>
        This page and the Omelet service on your computer come from different releases, so they can't safely
        talk to each other. Update Omelet from the desktop app, then try again.
      </p>
      <p className={s.detail}>
        page speaks api {SUPPORTED_API.join(", ")} · service speaks {agentApi === null ? "an older api" : `api ${agentApi}`}
      </p>
    </StatusScreen>
  );
}
