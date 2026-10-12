// Messages this app sent to chats that weren't live (a new chat's first message, a message typed
// into a chat whose machine is asleep). The server queues them for the agent and wakes the chat;
// until the conversation shows them, the chat screen shows them as the user wrote them, with a
// quiet "Starting…" line. Unit-tested in chat-store.test.ts.
import type { Jarvis3Api } from "./api";
import type { TaskView } from "./api-types";
import type { SentMessage } from "./chats";
import { messageOf, type Store } from "./stores";

export interface ChatMessagesState {
  /** Per chat, oldest first. */
  sent: Record<string, SentMessage[]>;
}

export function createChatMessagesStore(
  api: Jarvis3Api,
  deps: { onTask: (task: TaskView) => void; now?: () => number },
): Store<ChatMessagesState> & {
  /** A chat was created with this first message (already sent with the create). */
  recordFirst(taskId: string, requestId: string, text: string): void;
  /** Sends a message to a chat that isn't live; returns null, or the refusal in words. */
  send(taskId: string, requestId: string, text: string): Promise<string | null>;
  /** Forgets a failed message (its text went back into the composer). */
  discard(taskId: string, requestId: string): void;
  /** The conversation is live and shows everything sent: forget what was sent. */
  clearSent(taskId: string): void;
} {
  let state: ChatMessagesState = { sent: {} };
  const listeners = new Set<() => void>();
  const now = deps.now ?? (() => Date.now());
  const set = (sent: Record<string, SentMessage[]>) => {
    state = { sent };
    for (const listener of listeners) listener();
  };
  const update = (taskId: string, fn: (list: SentMessage[]) => SentMessage[]) => {
    const next = fn(state.sent[taskId] ?? []);
    const { [taskId]: _old, ...rest } = state.sent;
    set(next.length ? { ...rest, [taskId]: next } : rest);
  };
  const patch = (taskId: string, id: string, change: Partial<SentMessage>) =>
    update(taskId, (list) => list.map((m) => (m.id === id ? { ...m, ...change } : m)));

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    recordFirst(taskId, requestId, text) {
      update(taskId, (list) =>
        list.some((m) => m.id === requestId)
          ? list
          : [...list, { id: requestId, text, at: now(), state: "sent", error: null }],
      );
    },
    async send(taskId, requestId, text) {
      const existing = (state.sent[taskId] ?? []).find((m) => m.id === requestId);
      if (existing && existing.state !== "failed") return null;
      if (existing) patch(taskId, requestId, { state: "sending", error: null });
      else {
        update(taskId, (list) => [
          ...list,
          { id: requestId, text, at: now(), state: "sending", error: null },
        ]);
      }
      try {
        const result = await api.sendMessage(taskId, { text, requestId });
        deps.onTask(result.task);
        patch(taskId, requestId, { state: "sent" });
        return null;
      } catch (error) {
        const message = messageOf(error);
        patch(taskId, requestId, { state: "failed", error: message });
        return message;
      }
    },
    discard(taskId, requestId) {
      update(taskId, (list) => list.filter((m) => m.id !== requestId));
    },
    clearSent(taskId) {
      update(taskId, (list) => list.filter((m) => m.state !== "sent"));
    },
  };
}

export type ChatMessagesStore = ReturnType<typeof createChatMessagesStore>;
