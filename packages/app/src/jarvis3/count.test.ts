import { describe, expect, it } from "vitest";
import { countOf } from "./count";

describe("countOf", () => {
  it("uses the singular only for exactly one", () => {
    expect(countOf(1, "new post")).toBe("1 new post");
    expect(countOf(2, "new post")).toBe("2 new posts");
    expect(countOf(0, "file")).toBe("0 files");
    expect(countOf(1, "archived version")).toBe("1 archived version");
  });
  it("takes an irregular plural", () => {
    expect(countOf(3, "match", "matches")).toBe("3 matches");
    expect(countOf(1, "match", "matches")).toBe("1 match");
  });
});
