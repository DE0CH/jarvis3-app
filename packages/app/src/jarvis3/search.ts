// Transcript search (docs/API.md in DE0CH/jarvis3, "Transcript search"): pure decisions for the
// Search screen and the transcript reader. Unit-tested in search.test.ts.
import type { SearchHit, TaskState, TranscriptPage, TranscriptRole } from "./api-types";

export const QUERY_MAX = 200;

/** The query to send, or null when there is nothing to search for. */
export function normaliseQuery(raw: string): string | null {
  const query = raw.trim().replace(/\s+/g, " ");
  if (!query) return null;
  return query.slice(0, QUERY_MAX);
}

export interface Segment {
  text: string;
  match: boolean;
}

/**
 * Splits a snippet into plain and matched parts from the server's [start, end) ranges. Ranges
 * that overlap, run past the end or are empty are clamped or dropped, so a bad range never hides
 * text.
 */
export function highlightSegments(
  snippet: string,
  matches: readonly [number, number][],
): Segment[] {
  const ranges = matches
    .map(([start, end]) => [Math.max(0, start), Math.min(snippet.length, end)] as const)
    .filter(([start, end]) => end > start)
    .slice().sort((a, b) => a[0] - b[0]);
  const segments: Segment[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (end <= at) continue;
    const from = Math.max(start, at);
    if (from > at) segments.push({ text: snippet.slice(at, from), match: false });
    segments.push({ text: snippet.slice(from, end), match: true });
    at = end;
  }
  if (at < snippet.length) segments.push({ text: snippet.slice(at), match: false });
  return segments;
}

export function roleLabel(role: TranscriptRole): string {
  if (role === "user") return "You";
  if (role === "assistant") return "Agent";
  return "Tool";
}

/** The reader for a hit: the task's transcript around the matched message. */
export function transcriptHref(hit: Pick<SearchHit, "taskId" | "seq" | "agentId">): string {
  const query = new URLSearchParams({ around: String(hit.seq), agentId: hit.agentId });
  return `/search/${encodeURIComponent(hit.taskId)}?${query.toString()}`;
}

/** Whether the task's chat can be opened from the reader (it isn't archived or failed). */
export function canOpenChat(state: TaskState): boolean {
  return state !== "archived" && state !== "failed" && state !== "destroying";
}

export interface HitGroup {
  taskId: string;
  taskTitle: string;
  taskState: TaskState;
  userId: string;
  hits: SearchHit[];
}

/** Hits grouped by task, in the order the server ranked their best hit. */
export function groupHits(hits: readonly SearchHit[]): HitGroup[] {
  const groups = new Map<string, HitGroup>();
  for (const hit of hits) {
    const group = groups.get(hit.taskId) ?? {
      taskId: hit.taskId,
      taskTitle: hit.taskTitle,
      taskState: hit.taskState,
      userId: hit.userId,
      hits: [],
    };
    group.hits.push(hit);
    groups.set(hit.taskId, group);
  }
  return [...groups.values()];
}

/** A cursor value from the route's query, or null. */
export function parseSeq(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,15}$/.test(value)) return null;
  return Number(value);
}

/** Adds an older or newer page to what is shown, without duplicates. */
export function mergePage(
  prev: TranscriptPage,
  next: TranscriptPage,
  direction: "older" | "newer",
): TranscriptPage {
  const seen = new Set(prev.entries.map((e) => `${e.agentId}:${e.seq}`));
  const fresh = next.entries.filter((e) => !seen.has(`${e.agentId}:${e.seq}`));
  return direction === "older"
    ? { ...prev, entries: [...fresh, ...prev.entries], hasOlder: next.hasOlder }
    : { ...prev, entries: [...prev.entries, ...fresh], hasNewer: next.hasNewer };
}
