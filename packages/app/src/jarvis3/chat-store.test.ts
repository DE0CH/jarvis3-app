import { describe, expect, it, vi } from "vitest";
import type { Jarvis3Api } from "./api";
import type { TaskView } from "./api-types";
import { createChatMessagesStore } from "./chat-store";
import { Jarvis3Error } from "./plan";

const view = { id: "t1", state: "starting" } as TaskView;

function api(sendMessage: Jarvis3Api["sendMessage"]): Jarvis3Api {
  return { sendMessage } as Jarvis3Api;
}

describe("messages sent to a sleeping chat", () => {
  it("sends once per request id, keeps the task, and marks it sent", async () => {
    const send = vi.fn(async () => ({ task: view, messageId: "m1" }));
    const onTask = vi.fn();
    const store = createChatMessagesStore(api(send), { onTask, now: () => 5 });
    expect(await store.send("t1", "r1", "hello")).toBeNull();
    expect(await store.send("t1", "r1", "hello")).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("t1", { text: "hello", requestId: "r1" });
    expect(onTask).toHaveBeenCalledWith(view);
    expect(store.get().sent.t1).toEqual([
      { id: "r1", text: "hello", at: 5, state: "sent", error: null },
    ]);
  });
  it("keeps a refusal's words and lets the same message be sent again", async () => {
    let fail = true;
    const store = createChatMessagesStore(
      api(async () => {
        if (fail)
          throw new Jarvis3Error(
            "Your machine hours for this month are used up.",
            429,
            "machine_hours_cap",
          );
        return { task: view, messageId: "m" };
      }),
      { onTask: () => undefined },
    );
    expect(await store.send("t1", "r1", "hi")).toMatch(/machine hours/);
    expect(store.get().sent.t1?.[0]?.state).toBe("failed");
    fail = false;
    expect(await store.send("t1", "r1", "hi")).toBeNull();
    expect(store.get().sent.t1?.[0]?.state).toBe("sent");
  });
  it("records a new chat's first message and forgets sent ones once live", () => {
    const store = createChatMessagesStore(api(vi.fn()), { onTask: () => undefined });
    store.recordFirst("t2", "r", "first");
    expect(store.get().sent.t2?.[0]?.text).toBe("first");
    store.clearSent("t2");
    expect(store.get().sent.t2).toBeUndefined();
  });
});
