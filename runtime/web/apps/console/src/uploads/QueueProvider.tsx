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
  heldBy: UploadItem | null;
  landed: UploadItem | null;
  dismiss: () => void;
}

const Context = createContext<QueueContext | null>(null);

export function QueueProvider({ onSessionLost, children }: { onSessionLost: (reason: SessionLoss) => void; children: ReactNode }) {
  const client = useQueryClient();
  const [landed, setLanded] = useState<UploadItem | null>(null);
  const make = () =>
    new UploadQueue({
      api: createUploadApi(),
      onSessionLost,
      onLanded: (item) => {
        void client.invalidateQueries({ queryKey: FILES(item.projectId) });
        if (kindOf(item.name)) setLanded(item);
      },
    });
  const [queue, setQueue] = useState(make);

  useEffect(() => {
    // StrictMode unmounts and remounts once in development: the replayed
    // effect finds the queue disposed and swaps in a fresh one.
    if (queue.isDisposed) {
      setQueue(make);
      return;
    }
    return () => queue.dispose();
  }, [queue]);

  const items = useSyncExternalStore(queue.subscribe, queue.snapshot);
  const going = items.some((item) => item.state === "going");
  const heldBy = useMemo(() => items.find((item) => item.state === "noRoom" && item.uploadId !== null) ?? null, [items]);

  useEffect(() => {
    if (!going) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers only show the prompt when returnValue is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [going]);

  const value = useMemo(() => ({ queue, items, heldBy, landed, dismiss: () => setLanded(null) }), [queue, items, heldBy, landed]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useUploads(projectId: string) {
  const context = useContext(Context);
  if (!context) throw new Error("useUploads needs a QueueProvider");
  const { queue, items, heldBy, landed, dismiss } = context;
  const mine = useMemo(() => items.filter((item) => item.projectId === projectId), [items, projectId]);
  return { queue, items: mine, heldBy, landed: landed?.projectId === projectId ? landed : null, dismiss };
}
