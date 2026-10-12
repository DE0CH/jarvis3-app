// The chat-style app's pure decisions (tested in chats.test.ts): which tasks the sidebar lists and
// in which recency group, what the chat screen shows (the live conversation, or the indexed
// history with a composer), and the messages this app sent that the conversation doesn't show yet.
// The server calls a chat a task; nothing here mentions machines, pausing or resuming.
import type { TaskView, TranscriptEntry } from "./api-types";
import { Jarvis3Error } from "./plan";

/** A chat the user deleted (destroyed, archived server-side) is gone from the app. */
export function isDeleted(task: TaskView): boolean {
  return task.state === "archived" || task.state === "destroying";
}

function activity(task: TaskView): number {
  const at = Date.parse(task.lastActivityAt ?? task.createdAt);
  return Number.isFinite(at) ? at : 0;
}

/** The chats the sidebar lists: not deleted, most recent activity first. */
export function sidebarChats(tasks: readonly TaskView[]): TaskView[] {
  return tasks.filter((task) => !isDeleted(task)).sort((a, b) => activity(b) - activity(a));
}

export interface ChatGroup {
  label: string;
  chats: TaskView[];
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The recency group a time falls in, on the device's calendar: Today, Yesterday, Previous 7 days,
 * Previous 30 days, then the month ("September") in this year, then the year ("2025").
 */
export function recencyLabel(at: number, now: number): string {
  const today = startOfDay(now);
  const day = 24 * 60 * 60 * 1000;
  if (at >= today) return "Today";
  const yesterday = startOfDay(today - day / 2);
  if (at >= yesterday) return "Yesterday";
  if (at >= today - 7 * day) return "Previous 7 days";
  if (at >= today - 30 * day) return "Previous 30 days";
  const date = new Date(at);
  if (date.getFullYear() === new Date(now).getFullYear()) return MONTHS[date.getMonth()]!;
  return String(date.getFullYear());
}

/** The sidebar's chats in recency groups, newest group first. */
export function groupChats(tasks: readonly TaskView[], now: number): ChatGroup[] {
  const groups: ChatGroup[] = [];
  for (const chat of sidebarChats(tasks)) {
    const label = recencyLabel(activity(chat), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.chats.push(chat);
    else groups.push({ label, chats: [chat] });
  }
  return groups;
}

/** Chats whose title contains every word of the query (case-insensitive). */
export function filterChats(tasks: readonly TaskView[], query: string): TaskView[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return sidebarChats(tasks).filter((task) => {
    const title = task.title.toLowerCase();
    return words.every((word) => title.includes(word));
  });
}

// ---- the chat screen ------------------------------------------------------------------------

export type ChatView =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "error"; message: string }
  | { kind: "deleted" }
  /** Paseo's own conversation panel, on the task's host. */
  | { kind: "live"; serverId: string; agentId: string }
  /**
   * The indexed history plus this app's composer. `working`: the agent is being started or is
   * about to answer, so the screen shows a quiet "Starting…" line. `failed`: the chat couldn't
   * start and can't take messages.
   */
  | { kind: "history"; working: boolean; connect: boolean; failed: string | null };

export interface ChatViewInput {
  task: TaskView | null;
  loadError: Jarvis3Error | null;
  /** The task's Paseo host is known and connected. */
  hostServerId: string | null;
  hostOnline: boolean;
  /** The task's own agent, once the host has it. */
  agentId: string | null;
  /** This app sent a message the agent hasn't answered yet. */
  awaitingReply: boolean;
}

/** Live states: a machine exists or is being made. */
const LIVE = new Set<TaskView["state"]>(["starting", "running", "idle"]);

function planWithoutTask(loadError: Jarvis3Error | null): ChatView {
  if (loadError?.status === 404) return { kind: "not_found" };
  if (loadError) return { kind: "error", message: loadError.message };
  return { kind: "loading" };
}

function isStarting(task: TaskView, live: boolean, agentId: string | null): boolean {
  if (task.state === "starting") return true;
  if (task.busy?.kind === "creating" || task.busy?.kind === "resuming") return true;
  return live && !agentId;
}

export function planChatView(input: ChatViewInput): ChatView {
  const { task } = input;
  if (!task) return planWithoutTask(input.loadError);
  if (isDeleted(task)) return { kind: "deleted" };
  if (task.state === "failed") {
    return {
      kind: "history",
      working: false,
      connect: false,
      failed: task.error ?? "This chat couldn't start.",
    };
  }
  const live = LIVE.has(task.state) && task.busy?.kind !== "pausing";
  const hostReady = Boolean(input.hostServerId && input.hostOnline && input.agentId);
  if (live && task.connected && hostReady) {
    return { kind: "live", serverId: input.hostServerId!, agentId: input.agentId! };
  }
  const connect = live && task.connected;
  return {
    kind: "history",
    working: isStarting(task, live, input.agentId) || connect || input.awaitingReply,
    connect,
    failed: null,
  };
}

/** The screen polls the task while it is on its way to the live conversation. */
export function chatNeedsPolling(view: ChatView, task: TaskView | null): boolean {
  if (view.kind === "loading" || view.kind === "error") return true;
  if (view.kind !== "history" || view.failed) return false;
  if (!task) return true;
  return view.working || task.busy !== null || task.state === "starting";
}

// ---- messages this app sent -----------------------------------------------------------------

export interface SentMessage {
  /** The request id: a retry of the same message is the same message. */
  id: string;
  text: string;
  at: number;
  state: "sending" | "sent" | "failed";
  error: string | null;
}

/**
 * Messages sent from this app that the indexed history doesn't hold yet (it holds a message once
 * the session reported it): shown under the history, as the user wrote them.
 */
export function unseenMessages(
  sent: readonly SentMessage[],
  entries: readonly TranscriptEntry[],
): SentMessage[] {
  const said = entries.filter((entry) => entry.role === "user").map((entry) => entry.text.trim());
  const remaining = [...said];
  return sent.filter((message) => {
    const index = remaining.findIndex((text) => text === message.text.trim());
    if (index === -1) return true;
    remaining.splice(index, 1);
    return false;
  });
}

/** A transcript tool line ("name — input — output") as a step's name, summary and details. */
export function parseToolEntry(text: string): { name: string; summary: string; details: string } {
  const parts = text.split(" — ");
  const name = (parts[0] ?? "tool").trim() || "tool";
  const summary = (parts[1] ?? "").trim();
  const details = parts.slice(2).join(" — ").trim();
  return { name, summary, details };
}

/** A request id for one composer send. */
export function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
