import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { listingUrl } from "./paths";
import type { Disk } from "./uploadApi";

export interface DirEntry {
  name: string;
  kind: "file" | "folder";
  size: number | null;
  items: number | null;
  modified: number;
}

export interface Listing {
  dir: string;
  entries: DirEntry[];
}

export const FILES = (id: string) => ["files", id] as const;

export function useListing(id: string, dir: string) {
  return useQuery({
    queryKey: [...FILES(id), dir],
    queryFn: () => api.get<Listing>(listingUrl(id, dir)),
    refetchOnWindowFocus: true,
  });
}

export function useDisk(enabled: boolean) {
  return useQuery({
    queryKey: ["disk"],
    queryFn: () => api.get<Disk>("/api/disk"),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}
