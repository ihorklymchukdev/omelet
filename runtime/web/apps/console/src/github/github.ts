import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export const DEVICE_URL = "https://github.com/login/device";
export const REVOKE_URL = "https://github.com/settings/applications";
const POLL_MS = 2000;
const GITHUB = ["github"] as const;

export type SetupState = "applying" | "ready" | "failed" | "runtime_outdated";

export type GitHubStatus =
  | { state: "disconnected"; error: string | null }
  | { state: "pending"; user_code: string; url: string; expires_at: number }
  | { state: "connected"; login: string; name: string; email: string; setup: SetupState; setup_error: string | null }
  | { state: "needs_reconnect"; login: string };

export type Repo = { full_name: string; private: boolean; description: string | null; updated_at: number | null };
export type RepoPage = { repos: Repo[]; has_more: boolean };

export function polling(status?: GitHubStatus): boolean {
  return status?.state === "pending" || (status?.state === "connected" && status.setup === "applying");
}

export function useGitHub() {
  return useQuery({
    queryKey: GITHUB,
    queryFn: () => api.get<GitHubStatus>("/api/github"),
    refetchInterval: (query) => (polling(query.state.data) ? POLL_MS : false),
  });
}

function useStatusMutation(path: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<GitHubStatus>(path),
    onSuccess: (status) => client.setQueryData(GITHUB, status),
  });
}

export const useConnectGitHub = () => useStatusMutation("/api/github/connect");
export const useDisconnectGitHub = () => useStatusMutation("/api/github/disconnect");
export const useReapplyGitHub = () => useStatusMutation("/api/github/reapply");

export function useRepos(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...GITHUB, "repos"],
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get<RepoPage>(`/api/github/repos?page=${pageParam}`),
    getNextPageParam: (last, all) => (last.has_more ? all.length + 1 : undefined),
  });
}

export function useCloneRepo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (repo: string) => api.post<{ job_id: string; id: string }>("/api/github/clone", { repo }),
    // A revoked token turns the status to needs_reconnect server-side.
    onError: () => void client.invalidateQueries({ queryKey: GITHUB }),
  });
}
