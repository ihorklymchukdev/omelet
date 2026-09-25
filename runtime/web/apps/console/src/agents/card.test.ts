import { describe, expect, it } from "vitest";
import type { Guide } from "./catalog";
import { cardRows } from "./card";

const ssh: Guide = { viaSsh: true, tagline: "", steps: [] };
const wsl: Guide = { viaSsh: false, tagline: "", steps: [] };

describe("cardRows", () => {
  it("shows no card for a guide that does not go over SSH", () => {
    expect(cardRows(wsl, { vm: "lima", ssh: { host: "127.0.0.1", port: 39022, user: "ada", key_file: "~/k" } })).toBeNull();
  });

  it("gives Host, Port, User and Key file as separate copyable lines", () => {
    const rows = cardRows(ssh, { vm: "lima", ssh: { host: "127.0.0.1", port: 39022, user: "ada", key_file: "~/k" } });
    expect(rows).toEqual([
      { label: "Host", value: "127.0.0.1", copy: true },
      { label: "Port", value: "39022", copy: true },
      { label: "User", value: "ada", copy: true },
      { label: "Key file", value: "~/k", copy: true },
    ]);
  });

  it("says the user is unknown rather than offering an empty copy", () => {
    const rows = cardRows(ssh, { vm: "other", ssh: null });
    expect(rows?.find((row) => row.label === "User")).toEqual({ label: "User", value: "your Mac user name", copy: false });
    expect(rows?.find((row) => row.label === "Port")?.value).toBe("39022");
  });
});
