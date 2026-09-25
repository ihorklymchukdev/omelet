import { useRef, useState, type ReactNode } from "react";
import { Egg, cx } from "@omelet/ui";
import { api } from "../api/client";
import { useDesktopHome } from "../desktop/DesktopContext";
import { browserLink, openExternal } from "../desktop/desktop";
import { BACK, EXTERNAL } from "../screens/icons";
import s from "./Shell.module.css";

export function Shell({
  tone = "yolk",
  signedIn = false,
  leading,
  trailing,
  children,
}: {
  tone?: "yolk" | "cold";
  signedIn?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  const home = useDesktopHome();
  return (
    <div className={s.page}>
      <header className={cx(s.bar, tone === "cold" && s.muted)}>
        {home && (
          <>
            <a className={s.home} href={home}>{BACK}Home</a>
            <span className={s.divider} aria-hidden="true" />
          </>
        )}
        <Egg tone={tone} size={22} />
        <span className={s.brand}>{home ? "Projects" : "Omelet"}</span>
        {(signedIn || leading || trailing) && (
          <div className={s.end}>
            {leading}
            {signedIn && <span className={s.open}><span className={s.dot} aria-hidden="true" />Kitchen open</span>}
            {signedIn && home && <OpenInBrowser />}
            {trailing && <div className={s.trailing}>{trailing}</div>}
          </div>
        )}
      </header>
      <main className={s.content}>{children}</main>
    </div>
  );
}

// Codes last a minute; one fetched on hover is used well inside that.
const FRESH_MS = 40_000;

function OpenInBrowser() {
  const [busy, setBusy] = useState(false);
  const ready = useRef<{ url: string; at: number } | null>(null);

  // Fetched ahead of the click: WKWebView blocks a new window opened after
  // an await, once the click's user gesture has lapsed.
  const prepare = () => {
    if (ready.current && Date.now() - ready.current.at < FRESH_MS) return;
    void browserLink(api, window.location.origin).then((url) => {
      if (url.includes("#handoff=")) ready.current = { url, at: Date.now() };
    });
  };

  return (
    <button
      type="button"
      className={s.icon}
      aria-label="Open in browser"
      title="Open in browser"
      disabled={busy}
      onPointerEnter={prepare}
      onPointerDown={prepare}
      onFocus={prepare}
      onClick={async () => {
        const prepared = ready.current;
        ready.current = null;
        if (prepared && Date.now() - prepared.at < FRESH_MS) return openExternal(prepared.url);
        setBusy(true);
        try {
          openExternal(await browserLink(api, window.location.origin));
        } finally {
          setBusy(false);
        }
      }}
    >
      {EXTERNAL}
    </button>
  );
}
