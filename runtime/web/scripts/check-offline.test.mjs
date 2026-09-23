import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { problems, remoteRefs } from "./check-offline.mjs";

describe("the offline check", () => {
  it("catches a stylesheet that pulls fonts from Google", () => {
    const css = "@import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk');\n@import \"//cdn.example/x.css\";";
    expect(remoteRefs("index.css", css)).toEqual([
      "https://fonts.googleapis.com/css2?family=Hanken+Grotesk",
      "//cdn.example/x.css",
    ]);
  });

  it("catches an HTML page that loads a script or stylesheet from another host", () => {
    const html = '<link rel="stylesheet" href="https://fonts.googleapis.com/x"><script src="//cdn.example/a.js"></script>';
    expect(remoteRefs("index.html", html)).toEqual(["https://fonts.googleapis.com/x", "//cdn.example/a.js"]);
  });

  it("leaves relative, root and data: references alone", () => {
    const css = "src:url(/assets/a.woff2) format('woff2'),url(./b.woff2),url(data:font/woff2;base64,AAAA)";
    const html = '<link rel="icon" href="data:image/svg+xml,%3Csvg%3E"><script type="module" src="/assets/index.js"></script>';
    expect(remoteRefs("a.css", css)).toEqual([]);
    expect(remoteRefs("index.html", html)).toEqual([]);
  });

  it("fails a build folder that ships the mock worker, or holds nothing to check", () => {
    const dist = mkdtempSync(join(tmpdir(), "check-offline-"));
    expect(problems(dist)).toHaveLength(1);
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), '<script type="module" src="/assets/index.js"></script>');
    writeFileSync(join(dist, "assets", "index.css"), "a{background:url(/assets/x.png)}");
    expect(problems(dist)).toEqual([]);
    writeFileSync(join(dist, "mockServiceWorker.js"), "");
    expect(problems(dist)).toHaveLength(1);
  });
});
