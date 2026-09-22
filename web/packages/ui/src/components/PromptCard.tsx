import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import s from "./PromptCard.module.css";

const COPIED_MS = 2600;

const GIFT = (
  <svg className={s.gift} width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M2.6 7.5h12.8v7H2.6v-7ZM9 7.5v7M2.2 5.2h13.6v2.3H2.2V5.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M9 5.2S7.6 2.6 6.2 3.2C4.8 3.8 5.6 5.2 9 5.2Zm0 0s1.4-2.6 2.8-2c1.4.6.6 2-2.8 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

const COPY = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="5.2" y="2.5" width="8.3" height="8.3" rx="2" stroke="#2B1E14" strokeWidth="1.6" />
    <path d="M10.8 13.5H4.5a2 2 0 0 1-2-2V5.2" stroke="#2B1E14" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const CHECK = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3.2 8.4 6.4 11.6 12.8 4.8" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function PromptCard({
  prompt,
  title = "Copy this prompt",
  hint = "Paste it into your coding agent and press enter. That's the whole job.",
  aside,
}: {
  prompt: string;
  title?: string;
  hint?: ReactNode;
  aside?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const body = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; leave the prompt selected for Ctrl+C.
      const node = body.current;
      const selection = window.getSelection();
      if (!node || !selection) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  return (
    <section className={s.card}>
      <header className={s.head}>
        {GIFT}
        <span className={s.title}>{title}</span>
        {aside && <span className={s.aside}>{aside}</span>}
      </header>
      <div className={s.body}>
        <pre ref={body} className={s.prompt}>{prompt}</pre>
        <div className={s.row}>
          {copied ? (
            <span className={s.copied} role="status">{CHECK}Copied. It's yours.</span>
          ) : (
            <Button variant="primary" size="lg" onClick={copy}>{COPY}Copy the prompt</Button>
          )}
          <span className={s.hint}>{hint}</span>
        </div>
      </div>
    </section>
  );
}
