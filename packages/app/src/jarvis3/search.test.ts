import { describe, expect, it, vi } from "vitest";
import { createJarvis3Api } from "./api";
import type { SearchHit, TranscriptEntry, TranscriptPage } from "./api-types";
import {
  canOpenChat,
  groupHits,
  highlightSegments,
  mergePage,
  normaliseQuery,
  parseSeq,
  roleLabel,
  transcriptHref,
} from "./search";

function hit(patch: Partial<SearchHit>): SearchHit {
  return {
    taskId: "t1",
    taskTitle: "Task one",
    taskState: "archived",
    userId: "u1",
    agentId: "a1",
    seq: 3,
    role: "assistant",
    text: "the supplier invoice",
    at: "2026-10-10T10:00:00.000Z",
    snippet: "the supplier invoice",
    matches: [[4, 12]],
    ...patch,
  };
}

const seqsOf = (hits: SearchHit[]) => hits.map((h) => h.seq);

function entry(seq: number): TranscriptEntry {
  return { agentId: "a1", seq, role: "user", text: `m${seq}`, at: "2026-10-10T10:00:00.000Z" };
}

function page(seqs: number[], patch: Partial<TranscriptPage> = {}): TranscriptPage {
  return { taskId: "t1", entries: seqs.map(entry), hasOlder: false, hasNewer: false, ...patch };
}

describe("search", () => {
  it("normalises the query", () => {
    expect(normaliseQuery("  supplier   invoice ")).toBe("supplier invoice");
    expect(normaliseQuery("   ")).toBeNull();
    expect(normaliseQuery("x".repeat(300))).toHaveLength(200);
  });

  it("splits a snippet into highlighted segments", () => {
    expect(highlightSegments("the supplier invoice", [[4, 12]])).toEqual([
      { text: "the ", match: false },
      { text: "supplier", match: true },
      { text: " invoice", match: false },
    ]);
  });

  it("survives overlapping, unordered, empty and out-of-range matches", () => {
    expect(
      highlightSegments("abcdef", [
        [4, 99],
        [0, 2],
        [1, 3],
        [3, 3],
        [-5, -1],
      ]),
    ).toEqual([
      { text: "ab", match: true },
      { text: "c", match: true },
      { text: "d", match: false },
      { text: "ef", match: true },
    ]);
    expect(highlightSegments("abc", [])).toEqual([{ text: "abc", match: false }]);
    expect(highlightSegments("", [[0, 3]])).toEqual([]);
  });

  it("groups hits by task in ranking order", () => {
    const groups = groupHits([
      hit({ taskId: "t2", seq: 1 }),
      hit({ taskId: "t1", seq: 5 }),
      hit({ taskId: "t2", seq: 9 }),
    ]);
    expect(groups.map((g) => [g.taskId, seqsOf(g.hits)])).toEqual([
      ["t2", [1, 9]],
      ["t1", [5]],
    ]);
  });

  it("links a hit to its transcript and knows when the chat can open", () => {
    expect(transcriptHref(hit({ taskId: "t 1", seq: 7, agentId: "ag:1" }))).toBe(
      "/search/t%201?around=7&agentId=ag%3A1",
    );
    expect(canOpenChat("paused")).toBe(true);
    expect(canOpenChat("running")).toBe(true);
    expect(canOpenChat("archived")).toBe(false);
    expect(roleLabel("tool")).toBe("Tool");
    expect(parseSeq("12")).toBe(12);
    expect(parseSeq("-1")).toBeNull();
    expect(parseSeq(undefined)).toBeNull();
  });

  it("merges older and newer transcript pages without duplicates", () => {
    const start = page([5, 6, 7], { hasOlder: true, hasNewer: true });
    const older = mergePage(start, page([3, 4, 5], { hasOlder: false }), "older");
    expect(older.entries.map((e) => e.seq)).toEqual([3, 4, 5, 6, 7]);
    expect(older.hasOlder).toBe(false);
    expect(older.hasNewer).toBe(true);
    const newer = mergePage(older, page([7, 8], { hasNewer: false }), "newer");
    expect(newer.entries.map((e) => e.seq)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(newer.hasNewer).toBe(false);
  });

  it("calls the search and transcript routes with their query", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ query: "x", hits: [] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const api = createJarvis3Api({
      baseUrl: () => "https://i.example.org",
      authHeaders: () => null,
      credentials: "include",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await api.search({ q: "supplier invoice" });
    await api.search({ q: "x", all: true, limit: 10 });
    await api.transcript("t1", { agentId: "a1", around: 7 });
    await api.transcript("t1");
    const urls = (fetch.mock.calls as unknown as [string][]).map(([u]) =>
      u.replace("https://i.example.org", ""),
    );
    expect(urls).toEqual([
      "/api/search?q=supplier+invoice",
      "/api/search?q=x&limit=10&all=1",
      "/api/tasks/t1/transcript?agentId=a1&around=7",
      "/api/tasks/t1/transcript",
    ]);
  });
});
