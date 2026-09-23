import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { slugify } from "./slugify";

const CASES: { name: string; slug: string }[] = JSON.parse(
  readFileSync(new URL("../../../../../../tests/fixtures/slugify-cases.json", import.meta.url), "utf-8"),
);

describe("slugify", () => {
  it("has shared cases to check", () => {
    expect(CASES.length).toBeGreaterThan(0);
  });

  it("previews the same id the API creates for every shared case", () => {
    for (const { name, slug } of CASES) expect(slugify(name), name).toBe(slug);
  });
});
