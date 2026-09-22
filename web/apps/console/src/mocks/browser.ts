import { setupWorker } from "msw/browser";
import { handlersFor, scenarioFrom } from "./handlers";

export async function startMocks(): Promise<void> {
  const worker = setupWorker(...handlersFor(scenarioFrom(window.location.search)));
  await worker.start({ onUnhandledRequest: "bypass", quiet: true });
}
