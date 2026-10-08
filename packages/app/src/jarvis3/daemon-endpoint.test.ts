import { afterEach, describe, expect, it } from "vitest";
import {
  buildTaskDaemonUrl,
  isTaskDaemonUrl,
  jarvis3DaemonUrl,
  setJarvis3InstanceUrlResolver,
  taskEndpoint,
  taskIdFromEndpoint,
} from "./daemon-endpoint";
import { normalizeHostPort } from "@getpaseo/protocol/daemon-endpoints";

afterEach(() => setJarvis3InstanceUrlResolver(() => null));

describe("task pseudo-endpoints", () => {
  it("round-trips a task id and survives Paseo's endpoint normalisation", () => {
    const endpoint = taskEndpoint("7ce0326a5435ab61");
    expect(endpoint).toBe("t-7ce0326a5435ab61.jarvis3.invalid:443");
    expect(normalizeHostPort(endpoint)).toBe(endpoint);
    expect(taskIdFromEndpoint(endpoint)).toBe("7ce0326a5435ab61");
  });
  it("gives different tasks different endpoints (Paseo merges hosts that share one)", () => {
    expect(taskEndpoint("a1")).not.toBe(taskEndpoint("b2"));
  });
  it("ignores ordinary daemon endpoints", () => {
    expect(taskIdFromEndpoint("localhost:6767")).toBeNull();
    expect(taskIdFromEndpoint("jarvis.example.org:443")).toBeNull();
  });
  it("refuses ids that can't be a host label", () => {
    expect(() => taskEndpoint("a/b")).toThrow();
  });
});

describe("daemon URL hook", () => {
  it("builds the proxy URL from the instance URL", () => {
    expect(buildTaskDaemonUrl("https://jarvis.example.org", "abc")).toBe(
      "wss://jarvis.example.org/api/tasks/abc/daemon",
    );
    expect(buildTaskDaemonUrl("http://127.0.0.1:8080", "abc")).toBe(
      "ws://127.0.0.1:8080/api/tasks/abc/daemon",
    );
  });
  it("answers null for ordinary endpoints, so upstream builds its /ws URL", () => {
    setJarvis3InstanceUrlResolver(() => "https://jarvis.example.org");
    expect(jarvis3DaemonUrl("localhost:6767")).toBeNull();
    expect(jarvis3DaemonUrl(taskEndpoint("abc"))).toBe(
      "wss://jarvis.example.org/api/tasks/abc/daemon",
    );
  });
  it("fails loudly for a task host without a known instance", () => {
    setJarvis3InstanceUrlResolver(() => null);
    expect(() => jarvis3DaemonUrl(taskEndpoint("abc"))).toThrow(/instance/);
  });
  it("recognises proxy URLs for the device headers", () => {
    expect(
      isTaskDaemonUrl(
        "https://jarvis.example.org",
        "wss://jarvis.example.org/api/tasks/abc/daemon",
      ),
    ).toBe(true);
    expect(
      isTaskDaemonUrl("https://jarvis.example.org", "wss://other.example.org/api/tasks/abc/daemon"),
    ).toBe(false);
    expect(isTaskDaemonUrl("https://jarvis.example.org", "wss://jarvis.example.org/ws")).toBe(
      false,
    );
  });
});
