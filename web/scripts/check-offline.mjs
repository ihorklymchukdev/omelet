// Fails a build that would make the browser load anything from another host.
// Only CSS url()/@import and HTML src/href are read: the JS bundle carries URLs
// it never fetches (React's error links, SVG namespaces), and the page's CSP
// (default-src 'self') refuses runtime loads from other hosts anyway.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const CSS_REFS = /url\(\s*(['"]?)([^'")]*)\1\s*\)|@import\s+(['"])([^'"]*)\3/gi;
const HTML_REFS = /\s(?:src|href)\s*=\s*(['"])([^'"]*)\1/gi;

export function remoteRefs(name, text) {
  const pattern = name.endsWith(".css") ? CSS_REFS : name.endsWith(".html") ? HTML_REFS : null;
  if (pattern === null) return [];
  return [...text.matchAll(pattern)]
    .map((match) => (match[2] ?? match[4] ?? "").trim())
    .filter((ref) => ABSOLUTE.test(ref));
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

export function problems(dist) {
  const found = [];
  let checked = 0;
  for (const path of walk(dist)) {
    const name = basename(path);
    if (name === "mockServiceWorker.js") found.push(`${relative(dist, path)}: the dev-only mock worker`);
    if (name.endsWith(".css") || name.endsWith(".html")) {
      checked += 1;
      for (const ref of remoteRefs(name, readFileSync(path, "utf8"))) {
        found.push(`${relative(dist, path)}: loads ${ref}`);
      }
    }
  }
  if (checked === 0) found.push(`${dist}: no CSS or HTML to check — is this the build folder?`);
  return found;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = process.argv[2];
  if (!dist) {
    console.error("usage: check-offline.mjs <dist>");
    process.exit(2);
  }
  const found = problems(dist);
  if (found.length > 0) {
    console.error(`the build reaches outside this computer:\n  ${found.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`check-offline: ${dist} loads nothing from another host`);
}
