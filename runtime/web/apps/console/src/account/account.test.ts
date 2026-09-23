import { describe, expect, it } from "vitest";
import { signInLink } from "./account";

describe("signInLink", () => {
  it("accepts an https sign-in page", () => {
    const url = "https://omelet.bridgie.chat/device?user_code=ABCD-EFGH";
    expect(signInLink(url)).toBe(url);
  });

  it("refuses anything that is not https, local dev addresses included", () => {
    expect(signInLink("http://localhost:5174/device?user_code=X")).toBeNull();
    expect(signInLink("javascript:alert(1)")).toBeNull();
    expect(signInLink("not a url")).toBeNull();
  });
});
