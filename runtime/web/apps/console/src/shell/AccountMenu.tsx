import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@omelet/ui";
import type { Account } from "../account/account";
import { createApi } from "../api/client";

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
      {data?.state === "signed_in" && data.email && <span>{data.email}</span>}
      {error && <span role="alert">{error}</span>}
      <Button variant="quiet" onClick={signOut} disabled={leaving}>
        Sign out
      </Button>
    </>
  );
}
