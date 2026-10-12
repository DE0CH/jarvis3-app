import { describe, expect, it } from "vitest";
import type { TaskView, TranscriptEntry } from "./api-types";
import {
  chatNeedsPolling,
  filterChats,
  groupChats,
  parseToolEntry,
  planChatView,
  recencyLabel,
  sidebarChats,
  unseenMessages,
  type SentMessage,
} from "./chats";
import { Jarvis3Error } from "./plan";

function task(patch: Partial<TaskView> = {}): TaskView {
  return {
    id: "t1",
    userId: "u1",
    title: "Weekly report",
    model: "m",
    state: "idle",
    busy: null,
    error: null,
    pausedReason: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
    connected: true,
    agentId: "a1",
    lastActivityAt: "2026-10-01T09:00:00.000Z",
    projects: [],
    ...patch,
  };
}

const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe("recency groups", () => {
  const now = local(2026, 10, 12, 15);
  it("names the chat apps' groups", () => {
    expect(recencyLabel(local(2026, 10, 12, 1), now)).toBe("Today");
    expect(recencyLabel(local(2026, 10, 11, 23), now)).toBe("Yesterday");
    expect(recencyLabel(local(2026, 10, 7), now)).toBe("Previous 7 days");
    expect(recencyLabel(local(2026, 9, 20), now)).toBe("Previous 30 days");
    expect(recencyLabel(local(2026, 8, 3), now)).toBe("August");
    expect(recencyLabel(local(2025, 12, 30), now)).toBe("2025");
  });
  it("groups by last activity, newest first, and leaves deleted chats out", () => {
    const tasks = [
      task({ id: "old", lastActivityAt: new Date(local(2026, 8, 3)).toISOString() }),
      task({ id: "today", lastActivityAt: new Date(local(2026, 10, 12, 9)).toISOString() }),
      task({ id: "gone", state: "archived" }),
      task({ id: "today2", lastActivityAt: new Date(local(2026, 10, 12, 10)).toISOString() }),
    ];
    const ids = (chats: TaskView[]) => chats.map((c) => c.id);
    expect(groupChats(tasks, now).map((g) => [g.label, ids(g.chats)])).toEqual([
      ["Today", ["today2", "today"]],
      ["August", ["old"]],
    ]);
  });
  it("is not moved by pausing (only lastActivityAt counts)", () => {
    const a = task({
      id: "a",
      lastActivityAt: "2026-10-02T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
    });
    const b = task({ id: "b", lastActivityAt: "2026-10-03T00:00:00.000Z" });
    expect(sidebarChats([a, b]).map((t) => t.id)).toEqual(["b", "a"]);
  });
  it("filters by every word of the title", () => {
    const tasks = [
      task({ id: "a", title: "Q3 supplier summary" }),
      task({ id: "b", title: "Invoices" }),
    ];
    expect(filterChats(tasks, "supplier q3").map((t) => t.id)).toEqual(["a"]);
    expect(filterChats(tasks, "  ")).toEqual([]);
  });
});

describe("the chat screen", () => {
  const base = {
    loadError: null,
    hostServerId: null,
    hostOnline: false,
    agentId: null,
    awaitingReply: false,
  };
  it("loads, then a 404 is not found and other errors are errors", () => {
    expect(planChatView({ ...base, task: null }).kind).toBe("loading");
    expect(
      planChatView({ ...base, task: null, loadError: new Jarvis3Error("x", 404, "not_found") })
        .kind,
    ).toBe("not_found");
    expect(
      planChatView({ ...base, task: null, loadError: new Jarvis3Error("down", 0, "network") }),
    ).toEqual({ kind: "error", message: "down" });
  });
  it("opens the live conversation once the agent is on a connected host", () => {
    expect(
      planChatView({ ...base, task: task(), hostServerId: "srv", hostOnline: true, agentId: "a1" }),
    ).toEqual({ kind: "live", serverId: "srv", agentId: "a1" });
  });
  it("shows the history with Starting… while a new chat starts", () => {
    const view = planChatView({
      ...base,
      task: task({
        state: "starting",
        busy: { kind: "creating", since: "x" },
        connected: false,
        agentId: null,
      }),
    });
    expect(view).toEqual({ kind: "history", working: true, connect: false, failed: null });
  });
  it("a sleeping chat shows its history quietly, and Starting… once a message was sent", () => {
    const paused = task({ state: "paused", pausedReason: "idle", connected: false });
    expect(planChatView({ ...base, task: paused })).toMatchObject({
      kind: "history",
      working: false,
    });
    expect(planChatView({ ...base, task: paused, awaitingReply: true })).toMatchObject({
      kind: "history",
      working: true,
    });
  });
  it("connects to the host when the agent is connected but the host isn't there yet", () => {
    expect(planChatView({ ...base, task: task() })).toMatchObject({
      kind: "history",
      connect: true,
      working: true,
    });
  });
  it("a chat that couldn't start says so; a deleted chat is gone", () => {
    expect(
      planChatView({ ...base, task: task({ state: "failed", error: "no machine" }) }),
    ).toMatchObject({ failed: "no machine" });
    expect(planChatView({ ...base, task: task({ state: "archived" }) }).kind).toBe("deleted");
  });
  it("polls while it is on its way, not while asleep", () => {
    const paused = task({ state: "paused", connected: false });
    expect(chatNeedsPolling(planChatView({ ...base, task: paused }), paused)).toBe(false);
    expect(
      chatNeedsPolling(planChatView({ ...base, task: paused, awaitingReply: true }), paused),
    ).toBe(true);
    const live = planChatView({
      ...base,
      task: task(),
      hostServerId: "s",
      hostOnline: true,
      agentId: "a1",
    });
    expect(chatNeedsPolling(live, task())).toBe(false);
  });
});

describe("sent messages", () => {
  const sent = (id: string, text: string): SentMessage => ({
    id,
    text,
    at: 0,
    state: "sent",
    error: null,
  });
  const entry = (seq: number, role: TranscriptEntry["role"], text: string): TranscriptEntry => ({
    agentId: "a1",
    seq,
    role,
    text,
    at: "x",
  });
  it("shows what the history doesn't hold yet, once per copy", () => {
    const list = [sent("1", "hello"), sent("2", "hello"), sent("3", "next")];
    expect(unseenMessages(list, [entry(1, "user", "hello")]).map((m) => m.id)).toEqual(["2", "3"]);
    expect(unseenMessages(list, [entry(1, "assistant", "hello")])).toHaveLength(3);
  });
  it("reads a transcript tool line as a step", () => {
    expect(parseToolEntry("bash — ls -la — total 0")).toEqual({
      name: "bash",
      summary: "ls -la",
      details: "total 0",
    });
    expect(parseToolEntry("read")).toEqual({ name: "read", summary: "", details: "" });
  });
});
