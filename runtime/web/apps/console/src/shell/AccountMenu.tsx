import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
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
  // Rendered in every branch below: the modal must stay open across a
  // status change (e.g. connect -> code -> applying), not just while
  // view.kind is one of the branches that offers to open it.
  const modal = <GitHubModal open={open} onClose={() => setOpen(false)} />;

  let content: ReactNode;
  if (left && view.kind === "connect") {
    content = (
      <span>
        GitHub disconnected.{" "}
        <a href={REVOKE_URL} onClick={(e) => { e.preventDefault(); openExternal(REVOKE_URL); }}>
          Remove Omelet's access on GitHub
        </a>{" "}
        to revoke it fully.
        {" "}
        <Button variant="quiet" onClick={() => { setLeft(false); setOpen(true); }}>Connect GitHub</Button>
      </span>
    );
  } else if (view.kind === "ready" || view.kind === "applying" || view.kind === "setupFailed" || view.kind === "reconnect") {
    content = confirming ? (
      <>
        <span>Disconnect @{view.login}?</span>
        <Button variant="quiet" onClick={() => disconnect.mutate(undefined, { onSuccess: () => { setLeft(true); setConfirming(false); } })}>
          Disconnect
        </Button>
        <Button variant="quiet" onClick={() => setConfirming(false)}>Keep</Button>
      </>
    ) : view.kind === "reconnect" ? (
      <>
        <Button variant="quiet" onClick={() => setOpen(true)}>Reconnect GitHub</Button>
        <Button variant="quiet" onClick={() => setConfirming(true)}>Disconnect GitHub</Button>
      </>
    ) : (
      <>
        <span>GitHub: @{view.login}</span>
        <Button variant="quiet" onClick={() => setConfirming(true)}>Disconnect GitHub</Button>
      </>
    );
  } else {
    content = <Button variant="quiet" onClick={() => setOpen(true)}>Connect GitHub</Button>;
  }

  return (
    <>
      {content}
      {modal}
    </>
  );
}
