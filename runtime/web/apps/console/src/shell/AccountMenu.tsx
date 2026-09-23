import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@omelet/ui";
import type { Account } from "../account/account";
import { createApi } from "../api/client";

const api = createApi((input, init) => fetch(input, init));

export function AccountMenu({ onSignedOut }: { onSignedOut: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const { data } = useQuery({
    queryKey: ["account"],
    queryFn: () => api.get<Account>("/api/account"),
    refetchInterval: 60_000,
  });

  // Revoked from the web app, or signed out in another tab.
  useEffect(() => {
    if (data && data.state !== "signed_in") onSignedOut();
  }, [data, onSignedOut]);

  const signOut = async () => {
    setLeaving(true);
    try {
      await api.post("/api/account/sign-out");
    } finally {
      onSignedOut();
    }
  };

  return (
    <>
      {data?.state === "signed_in" && data.email && <span>{data.email}</span>}
      <Button variant="quiet" onClick={signOut} disabled={leaving}>
        Sign out
      </Button>
    </>
  );
}
