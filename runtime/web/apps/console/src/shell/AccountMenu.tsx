import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@omelet/ui";
import type { Account } from "../account/account";
import { createApi } from "../api/client";
import { openExternal } from "../desktop/desktop";
import { REVOKE_URL, useDisconnectGitHub, useGitHub } from "../github/github";
import { githubView } from "../github/view";
import { GitHubModal } from "../screens/github/GitHubModal";

const api = createApi((input, init) => fetch(input, init));

export function AccountMenu({ onSignedOut }: { onSignedOut: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["account"],
    queryFn: () => api.get<Account>("/api/account"),
    refetchInterval: 60_000,
  });

  // Revoked from the web app, or signed out in another tab.
  useEffect(() => {
    if (data && data.state !== "signed_in") {
      // A later remount must start from a fresh fetch, not this stale answer.
      queryClient.removeQueries({ queryKey: ["account"] });
      onSignedOut();
    }
  }, [data, onSignedOut, queryClient]);

  const signOut = async () => {
    setLeaving(true);
    setError(null);
    try {
      await api.post("/api/account/sign-out");
      queryClient.removeQueries({ queryKey: ["account"] });
      onSignedOut();
    } catch {
      setLeaving(false);
      setError("Couldn't sign out. Try again.");
    }
  };

  return (
    <>
      <GitHubLine />
      {data?.state === "signed_in" && data.email && <span>{data.email}</span>}
      {error && <span role="alert">{error}</span>}
      <Button variant="quiet" onClick={signOut} disabled={leaving}>
        Sign out
      </Button>
    </>
  );
}

function GitHubLine() {
  const status = useGitHub().data;
  const disconnect = useDisconnectGitHub();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [left, setLeft] = useState(false);
  if (!status) return null;
  const view = githubView(status);
  const modal = <GitHubModal open={open} onClose={() => setOpen(false)} />;
  if (left && view.kind === "connect") {
    return (
      <span>
        GitHub disconnected.{" "}
        <a href={REVOKE_URL} onClick={(e) => { e.preventDefault(); openExternal(REVOKE_URL); }}>
          Remove Omelet's access on GitHub
        </a>{" "}
        to revoke it fully.
      </span>
    );
  }
  if (view.kind === "ready" || view.kind === "applying" || view.kind === "setupFailed") {
    return confirming ? (
      <>
        <span>Disconnect @{view.login}?</span>
        <Button variant="quiet" onClick={() => disconnect.mutate(undefined, { onSuccess: () => { setLeft(true); setConfirming(false); } })}>
          Disconnect
        </Button>
        <Button variant="quiet" onClick={() => setConfirming(false)}>Keep</Button>
      </>
    ) : (
      <>
        <span>GitHub: @{view.login}</span>
        <Button variant="quiet" onClick={() => setConfirming(true)}>Disconnect GitHub</Button>
      </>
    );
  }
  return (
    <>
      <Button variant="quiet" onClick={() => setOpen(true)}>
        {view.kind === "reconnect" ? "Reconnect GitHub" : "Connect GitHub"}
      </Button>
      {modal}
    </>
  );
}
