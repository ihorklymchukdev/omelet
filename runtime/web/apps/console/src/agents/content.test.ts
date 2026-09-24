import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAgent, parseIndex } from "./catalog";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../agents");
const read = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

describe("shipped agent content", () => {
  const ids = parseIndex(read("index.json"));

  it.each(ids)("%s parses, has both platforms, and every file it names exists", (id) => {
    const agent = parseAgent(id, read(`${id}/agent.json`), "");
    expect(agent).not.toBeNull();
    expect(Object.keys(agent!.platforms).sort()).toEqual(["mac", "windows"]);
    expect(agent!.platforms.mac!.viaSsh).toBe(true);
    expect(agent!.platforms.windows!.viaSsh).toBe(false);
    const files = [agent!.icon, ...Object.values(agent!.platforms).flatMap((g) => g!.steps.map((s) => s.screenshot))];
    for (const file of files) if (file) expect(existsSync(join(ROOT, file)), file).toBe(true);
  });
});
