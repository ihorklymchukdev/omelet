import "@omelet/ui/fonts";
import "@omelet/ui/tokens.css";
import "./app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { takeHandoff } from "./boot/boot";

// Taken before anything renders or awaits, so a reload never resends the code.
const handoff = takeHandoff(window.location, window.history);

async function start() {
  if (import.meta.env.DEV) {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App handoff={handoff} />
    </StrictMode>,
  );
}

void start();
