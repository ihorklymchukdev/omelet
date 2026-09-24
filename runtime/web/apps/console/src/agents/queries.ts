import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { loadCatalog, platformFor, type Connect } from "./catalog";

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

export function useAgents() {
  const connect = useQuery({ queryKey: ["connect"], queryFn: () => api.get<Connect>("/api/connect"), staleTime: Infinity, retry: false });
  const catalog = useQuery({ queryKey: ["agents"], queryFn: () => loadCatalog(fetchJson), staleTime: Infinity });
  // Waits for /connect to settle either way: an API without it still gets
  // guides, chosen from the browser.
  const platform = platformFor(connect.data, navigator.userAgent);
  const agents = connect.isPending ? undefined : catalog.data?.filter((agent) => agent.platforms[platform]);
  return { platform, agents, connect: connect.data, error: catalog.error };
}
