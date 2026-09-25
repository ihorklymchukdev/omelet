import type { Connect, Guide } from "./catalog";

export interface CardRow { label: string; value: string; copy: boolean }

// The API's own values, for a guest that could not say who its user is.
const HOST = "127.0.0.1";
const PORT = "39022";
const KEY_FILE = "~/.lima/_config/user";

export function cardRows(guide: Guide, connect: Connect | undefined): CardRow[] | null {
  if (!guide.viaSsh) return null;
  const ssh = connect?.ssh;
  return [
    { label: "Host", value: ssh?.host ?? HOST, copy: true },
    { label: "Port", value: ssh ? String(ssh.port) : PORT, copy: true },
    ssh ? { label: "User", value: ssh.user, copy: true } : { label: "User", value: "your Mac user name", copy: false },
    { label: "Key file", value: ssh?.key_file ?? KEY_FILE, copy: true },
  ];
}
