import { describe, expect, it } from "vitest";
import { fileUrl, filesRoute, folderNameError, joinPath, parentOf } from "./paths";

describe("upload paths", () => {
  it("joins without leading, trailing or double slashes, so the top of the project is ''", () => {
    expect(joinPath("", "a.sql")).toBe("a.sql");
    expect(joinPath("data/", "/dumps", "a.sql")).toBe("data/dumps/a.sql");
    expect(joinPath("")).toBe("");
  });

  it("refuses a new folder name the API would reject as a traversal or a nested path", () => {
    expect(folderNameError("dumps")).toBeNull();
    expect(folderNameError("  ")).not.toBeNull();
    expect(folderNameError("a/b")).not.toBeNull();
    expect(folderNameError("a\\b")).not.toBeNull();
    expect(folderNameError("..")).not.toBeNull();
    expect(folderNameError(".")).not.toBeNull();
  });

  it("finds the parent folder of a nested and a top-level path", () => {
    expect(parentOf("data/dumps/a.sql")).toBe("data/dumps");
    expect(parentOf("a.sql")).toBe("");
  });

  it("encodes each path segment but keeps the slashes between them", () => {
    expect(fileUrl("recipe-box", "data/my file#1.sql")).toBe("/api/projects/recipe-box/files/data/my%20file%231.sql");
    expect(filesRoute("recipe-box", "")).toBe("/p/recipe-box/files");
    expect(filesRoute("recipe-box", "data/a b")).toBe("/p/recipe-box/files/data/a%20b");
  });
});
