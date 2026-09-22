import { useCallback, useEffect, useRef, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { createQueryClient } from "./api/queryClient";
import { boot, type BootResult } from "./boot/boot";
import { Kit } from "./screens/Kit";
import { NeedsUpdate } from "./screens/NeedsUpdate";
import { NotAnswering } from "./screens/NotAnswering";
import { Projects } from "./screens/Projects";
import { SignedOut } from "./screens/SignedOut";
import { Shell } from "./shell/Shell";

export function App({ handoff }: { handoff: string | null }) {
  const [result, setResult] = useState<BootResult | null>(null);
  const pendingHandoff = useRef(handoff);
  const running = useRef(false);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    // Emptied before the first await: the code is single-use, and StrictMode
    // runs this effect twice in development.
    const code = pendingHandoff.current;
    pendingHandoff.current = null;
    try {
      setResult(await boot({ fetch: (input, init) => fetch(input, init), handoff: code }));
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const [queryClient] = useState(() =>
    createQueryClient((reason) => setResult({ kind: "signedOut", reason })),
  );

  if (result === null) return <Shell />;

  switch (result.kind) {
    case "signedIn":
      return (
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Shell>
              <Routes>
                <Route path="/kit" element={<Kit />} />
                <Route path="*" element={<Projects />} />
              </Routes>
            </Shell>
          </BrowserRouter>
        </QueryClientProvider>
      );
    case "signedOut":
      return <SignedOut reason={result.reason} onRetry={run} />;
    case "needsUpdate":
      return <NeedsUpdate agentApi={result.agentApi} onRetry={run} />;
    case "notAnswering":
      return <NotAnswering onRetry={run} />;
  }
}
