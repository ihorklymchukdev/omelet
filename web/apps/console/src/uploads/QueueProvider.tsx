import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SessionLoss } from "../api/client";
import { kindOf } from "./kinds";
import { FILES } from "./queries";
import { UploadQueue, type UploadItem } from "./queue";
import { createUploadApi } from "./uploadApi";

interface QueueContext {
  queue: UploadQueue;
  items: readonly UploadItem[];
  landed: UploadItem | null;
  dismiss: () => void;
}

const Context = createContext<QueueContext | null>(null);

export function QueueProvider({ onSessionLost, children }: { onSessionLost: (reason: SessionLoss) => void; children: ReactNode }) {
  const client = useQueryClient();
  const [landed, setLanded] = useState<UploadItem | null>(null);
  const [queue] = useState(
    () =>
      new UploadQueue({
        api: createUploadApi(),
        onSessionLost,
        onLanded: (item) => {
          void client.invalidateQueries({ queryKey: FILES(item.projectId) });
          if (kindOf(item.name)) setLanded(item);
        },
      }),
  );
  const items = useSyncExternalStore(queue.subscribe, queue.snapshot);
  const going = items.some((item) => item.state === "going");

  useEffect(() => {
    if (!going) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [going]);

  const value = useMemo(() => ({ queue, items, landed, dismiss: () => setLanded(null) }), [queue, items, landed]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useUploads(projectId: string) {
  const context = useContext(Context);
  if (!context) throw new Error("useUploads needs a QueueProvider");
  const { queue, items, landed, dismiss } = context;
  const mine = useMemo(() => items.filter((item) => item.projectId === projectId), [items, projectId]);
  return { queue, items: mine, landed: landed?.projectId === projectId ? landed : null, dismiss };
}
