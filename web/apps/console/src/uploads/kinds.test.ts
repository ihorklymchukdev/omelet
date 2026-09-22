import { describe, expect, it } from "vitest";
import { kindOf } from "./kinds";

describe("kindOf", () => {
  it("recognises dumps, including the double extension and upper case", () => {
    expect(kindOf("orders-dump.sql")).toBe("dump");
    expect(kindOf("orders.SQL.GZ")).toBe("dump");
    expect(kindOf("prod.dump")).toBe("dump");
    expect(kindOf("site.bak")).toBe("dump");
  });

  it("recognises archives and does not mistake a .sql.gz for one", () => {
    expect(kindOf("media-library.zip")).toBe("archive");
    expect(kindOf("site.tar.gz")).toBe("archive");
    expect(kindOf("site.tgz")).toBe("archive");
  });

  it("gives nothing for other files, no extension, or a disguised name", () => {
    expect(kindOf("README.md")).toBeNull();
    expect(kindOf("Makefile")).toBeNull();
    expect(kindOf("archive.zip.txt")).toBeNull();
  });
});
