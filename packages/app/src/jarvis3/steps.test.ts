import { describe, expect, it } from "vitest";
import { stepLabel } from "./steps";

describe("step labels", () => {
  it("names steps in plain words", () => {
    expect(stepLabel({ toolName: "bash" })).toBe("Ran a command");
    expect(stepLabel({ toolName: "read" })).toBe("Read a file");
    expect(stepLabel({ toolName: "edit" })).toBe("Edited a file");
    expect(stepLabel({ toolName: "web_search" })).toBe("Searched the web");
    expect(stepLabel({ toolName: "jarvis.jarvis_post" })).toBe("Posted to the channel");
  });
  it("uses Paseo's detail kind when the name is unknown", () => {
    expect(stepLabel({ toolName: "Shell", detailType: "shell" })).toBe("Ran a command");
    expect(stepLabel({ toolName: "x", detailType: "search", searchKind: "web_search" })).toBe(
      "Searched the web",
    );
    expect(stepLabel({ toolName: "x", detailType: "search", searchKind: "grep" })).toBe(
      "Searched files",
    );
  });
  it("is present tense while running, and null for an unknown tool", () => {
    expect(stepLabel({ toolName: "bash", running: true })).toBe("Running a command…");
    expect(stepLabel({ toolName: "mystery" })).toBeNull();
  });
});
