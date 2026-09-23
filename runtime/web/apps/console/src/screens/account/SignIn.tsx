import { useCallback, useEffect, useState } from "react";
import { Button } from "@omelet/ui";
import { type Account, signInError, signInLink } from "../../account/account";
import { ApiError, createApi } from "../../api/client";
import { Qr } from "../../components/Qr";
import { useNow } from "../../projects/useNow";
import { SleepyEgg } from "../SleepyEgg";
import { StatusScreen } from "../StatusScreen";
import s from "../StatusScreen.module.css";
import own from "./SignIn.module.css";

const api = createApi((input, init) => fetch(input, init));
const POLL_MS = 3000;

type View = { account: Account | null; unreachable: boolean; starting: boolean };

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [view, setView] = useState<View>({ account: null, unreachable: false, starting: false });

  const refresh = useCallback(async () => {
    try {
      const account = await api.get<Account>("/api/account");
      if (account.state === "signed_in") onSignedIn();
      else setView((v) => ({ ...v, account }));
    } catch {
      // A missed poll is retried on the next tick.
    }
  }, [onSignedIn]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const start = async () => {
    setView((v) => ({ ...v, starting: true, unreachable: false }));
    try {
      const account = await api.post<Account>("/api/account/sign-in");
      setView({ account, unreachable: false, starting: false });
    } catch (error) {
      const unreachable = error instanceof ApiError && error.code === "cloud_unavailable";
      setView((v) => ({ ...v, unreachable, starting: false }));
    }
  };

  const account = view.account;
  if (account?.state === "pending") return <Pending account={account} onRestart={start} />;

  const reason = view.unreachable
    ? "The Omelet service can't be reached right now. Check the internet connection."
    : signInError(account?.state === "signed_out" ? account.error : null);
  return (
    <StatusScreen
      art={<SleepyEgg />}
      title="Sign in to Omelet"
      actions={
        <Button variant="primary" size="lg" onClick={start} disabled={view.starting}>
          {view.unreachable ? "Try again" : "Sign in"}
        </Button>
      }
      footer="Your projects keep running while you sign in."
    >
      {reason && <p className={own.error}>{reason}</p>}
      <p className={s.lead}>Your Omelet account keeps track of your projects. Sign in once on this computer.</p>
    </StatusScreen>
  );
}

function Pending({ account, onRestart }: { account: Extract<Account, { state: "pending" }>; onRestart: () => void }) {
  const now = useNow(1000);
  const left = Math.max(0, Math.round(account.expires_at - now / 1000));
  const link = signInLink(account.url);
  if (link === null) {
    return (
      <StatusScreen art={<SleepyEgg />} title="Sign-in isn't available" actions={<Button onClick={onRestart}>Try again</Button>}>
        <p className={s.lead}>The sign-in link from the Omelet service is not valid.</p>
        <p className={s.detail}>{account.url}</p>
      </StatusScreen>
    );
  }
  return (
    <StatusScreen
      tone="yolk"
      art={
        <div className={own.qr}>
          <Qr value={link} />
        </div>
      }
      title="Approve this computer"
      actions={
        <a className={own.link} href={link} target="_blank" rel="noopener noreferrer">
          Open the sign-in page
        </a>
      }
      footer={left > 0 ? `This code works for ${Math.ceil(left / 60)} more minute${left > 60 ? "s" : ""}.` : "This code has run out."}
    >
      <p className={s.lead}>Scan the code with your phone, or open the sign-in page, and check it shows:</p>
      <p className={own.code}>{account.user_code}</p>
    </StatusScreen>
  );
}
