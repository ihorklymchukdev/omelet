import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

// The kit moves to its own repository later: it may lean on React and its
// fonts, never on the app, its data layer or the network.
const ALLOWED_PACKAGE = /^(react|react-dom)(\/|$)|^@fontsource(-variable)?\//;
const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the kit", () => {
  const files = sources(SRC);

  it("has components to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("imports only React, its fonts and its own files", () => {
    const offences: string[] = [];
    for (const file of files) {
      for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
        const spec = (match[1] ?? match[2])!;
        const escapes = spec.startsWith(".") && relative(SRC, resolve(dirname(file), spec)).startsWith("..");
        if (escapes || (!spec.startsWith(".") && !ALLOWED_PACKAGE.test(spec))) {
          offences.push(`${relative(SRC, file)} imports ${spec}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("never calls fetch", () => {
    const callers = files.filter((file) => /\bfetch\s*\(/.test(readFileSync(file, "utf8")));
    expect(callers.map((file) => relative(SRC, file))).toEqual([]);
  });
});
