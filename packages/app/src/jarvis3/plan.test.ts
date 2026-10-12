import { describe, expect, it } from "vitest";
import type { SuggestionView, TaskView, UserDetail } from "./api-types";
import {
  canDownloadArchive,
  canUndoLayer,
  describeToolsAdmin,
  describeToolsUsage,
  myUsageRows,
  describeUsage,
  openSuggestionFor,
  presentSuggestion,
  suggestionTargetLabel,
  errorFromResponse,
  formatLimit,
  formatMachineTime,
  isAccessRefusal,
  isLayerEmpty,
  Jarvis3Error,
  mergeTask,
  pairErrorMessage,
  parseLimitInput,
  toolsCapReached,
  parsePairRedirect,
  noticesLabel,
  resolveInstanceUrl,
  signOutMessage,
  signOutReason,
  stateLabel,
  taskAgentOnHost,
  taskListNeedsRefresh,
  validateSkill,
} from "./plan";

function task(patch: Partial<TaskView> = {}): TaskView {
  return {
    id: "7ce0326a5435ab61",
    userId: "u1",
    title: "Write the weekly report",
    model: "anthropic/claude-x",
    state: "running",
    busy: null,
    error: null,
    pausedReason: null,
    createdAt: "2026-10-08T12:00:00.000Z",
    updatedAt: "2026-10-08T12:00:00.000Z",
    connected: true,
    agentId: null,
    lastActivityAt: "2026-10-08T12:00:00.000Z",
    projects: [],
    ...patch,
  };
}

describe("resolveInstanceUrl", () => {
  it("uses the page's origin on the web", () => {
    expect(
      resolveInstanceUrl({
        platform: "web",
        extraUrl: "https://jarvis.example.org",
        origin: "https://a.example.org",
      }),
    ).toBe("https://a.example.org");
  });
  it("uses the configured URL on iOS, without a trailing slash", () => {
    expect(
      resolveInstanceUrl({
        platform: "ios",
        extraUrl: "https://jarvis.example.org/",
        origin: null,
      }),
    ).toBe("https://jarvis.example.org");
  });
  it("is null when nothing is known", () => {
    expect(resolveInstanceUrl({ platform: "ios", extraUrl: undefined, origin: null })).toBeNull();
  });
});

describe("formatMachineTime", () => {
  it("shows minutes under an hour, hours above", () => {
    expect(formatMachineTime(0.05)).toBe("3 min");
    expect(formatMachineTime(0)).toBe("0 min");
    expect(formatMachineTime(3.25)).toBe("3.3 h");
  });
});

describe("stateLabel", () => {
  it("never names machine states: a chat, deleted, or one that couldn't start", () => {
    expect(stateLabel("paused")).toBe("Chat");
    expect(stateLabel("running")).toBe("Chat");
    expect(stateLabel("archived")).toBe("Deleted");
    expect(stateLabel("failed")).toBe("Couldn't start");
  });
});

describe("task list", () => {
  it("refreshes while something changes state", () => {
    expect(taskListNeedsRefresh([task()])).toBe(false);
    expect(taskListNeedsRefresh([task({ state: "starting" })])).toBe(true);
    expect(taskListNeedsRefresh([task({ connected: false })])).toBe(true);
    expect(
      taskListNeedsRefresh([task({ state: "paused", busy: { kind: "resuming", since: "x" } })]),
    ).toBe(true);
    expect(taskListNeedsRefresh([task({ state: "paused", connected: false })])).toBe(false);
  });
  it("merges a task in place, or adds it at the top", () => {
    const list = [task({ id: "a" }), task({ id: "b" })];
    expect(mergeTask(list, task({ id: "b", title: "new" })).map((t) => t.title)).toEqual([
      "Write the weekly report",
      "new",
    ]);
    expect(mergeTask(list, task({ id: "c" })).map((t) => t.id)).toEqual(["c", "a", "b"]);
  });
});

describe("taskAgentOnHost", () => {
  it("is the agent the session reported, once the host has it", () => {
    expect(taskAgentOnHost(task({ agentId: "main" }), ["helper", "main"])).toBe("main");
  });
  it("never guesses: null without a reported id, or while the host lacks it", () => {
    expect(taskAgentOnHost(task({ agentId: null }), ["helper", "main"])).toBeNull();
    expect(taskAgentOnHost(task({ agentId: "main" }), ["helper"])).toBeNull();
    expect(taskAgentOnHost(null, ["main"])).toBeNull();
  });
});

describe("errors", () => {
  it("reads the API's error body", () => {
    const error = errorFromResponse(409, {
      error: { code: "busy", message: "another operation is running" },
    });
    expect(error.code).toBe("busy");
    expect(error.message).toBe("Another operation is running");
  });
  it("explains caps in plain words", () => {
    expect(
      errorFromResponse(429, { error: { code: "machine_hours_cap", message: "cap" } }).message,
    ).toMatch(/machine hours/);
  });
  it("falls back on the status when the body isn't the API's", () => {
    expect(errorFromResponse(404, null).code).toBe("not_found");
    expect(errorFromResponse(502, "oops").code).toBe("internal");
  });
  it("recognises Access's login page", () => {
    expect(
      isAccessRefusal({
        finalUrl: "https://t.cloudflareaccess.com/cdn-cgi/access/login/x",
        status: 200,
        contentType: "text/html",
      }),
    ).toBe(true);
    expect(
      isAccessRefusal({
        finalUrl: "https://i.example.org/api/me",
        status: 200,
        contentType: "application/json",
      }),
    ).toBe(false);
    expect(
      isAccessRefusal({
        finalUrl: "https://i.example.org/api/me",
        status: 200,
        contentType: "text/html; charset=utf-8",
      }),
    ).toBe(true);
  });
});

describe("parsePairRedirect", () => {
  it("reads a successful pairing", () => {
    expect(
      parsePairRedirect("jarvis3://paired?state=s1&id=d1&clientId=c&clientSecret=x", "s1"),
    ).toEqual({
      status: "paired",
      id: "d1",
      clientId: "c",
      clientSecret: "x",
    });
  });
  it("refuses a different state", () => {
    expect(
      parsePairRedirect("jarvis3://paired?state=other&id=d1&clientId=c&clientSecret=x", "s1")
        .status,
    ).toBe("error");
  });
  it("reads an error with its HTTP status", () => {
    const answer = parsePairRedirect("jarvis3://paired?state=s1&error=too%20soon&status=429", "s1");
    expect(answer).toEqual({ status: "error", error: "too soon", httpStatus: "429" });
    if (answer.status === "error") expect(pairErrorMessage(answer)).toMatch(/30 seconds/);
  });
});

describe("personal layer", () => {
  it("validates skills like the server", () => {
    expect(validateSkill("invoices", { "SKILL.md": "x" })).toBeNull();
    expect(validateSkill("Invoices", { "SKILL.md": "x" })).toMatch(/lowercase/);
    expect(validateSkill("invoices", { "README.md": "x" })).toMatch(/SKILL.md/);
    expect(validateSkill("invoices", { "SKILL.md": "x", "../evil": "x" })).toMatch(
      /valid file name/,
    );
    expect(validateSkill("invoices", { "SKILL.md": "x".repeat(300 * 1024) })).toMatch(/256 KiB/);
    expect(validateSkill("invoices", { "SKILL.md": "x", "refs/vendors.md": "y" })).toBeNull();
  });
  it("knows when the layer is empty and when Undo is possible", () => {
    expect(isLayerEmpty({ instructions: "  ", skills: [], notes: [] })).toBe(true);
    expect(isLayerEmpty({ instructions: "German", skills: [], notes: [] })).toBe(false);
    expect(canUndoLayer({ versions: [] })).toBe(false);
    expect(canUndoLayer({ versions: [{ version: 1, createdAt: "x", reason: "reset" }] })).toBe(
      true,
    );
  });
});

describe("admin limits", () => {
  it("reads empty as clear, a number as an override, and refuses the rest", () => {
    expect(parseLimitInput("")).toEqual({ ok: true, value: null });
    expect(parseLimitInput(" 50 ")).toEqual({ ok: true, value: 50 });
    expect(parseLimitInput("-1").ok).toBe(false);
    expect(parseLimitInput("abc").ok).toBe(false);
  });
  it("formats limits", () => {
    expect(formatLimit(null, "usd")).toBe("No limit");
    expect(formatLimit(20, "usd")).toBe("USD 20.00");
    expect(formatLimit(10, "hours")).toBe("10 h");
  });
});

describe("admin usage summary", () => {
  const detail = (capReached: boolean) => ({
    limits: {
      openrouterMonthlyUsd: 20,
      openrouterOverride: false,
      machineHoursPerMonth: 10,
      machineHoursOverride: true,
    },
    usage: {
      month: "2026-10",
      machineHours: 10.04,
      machineHoursCapReached: capReached,
      openrouterKey: true,
    },
  });
  it("shows use against the cap and says when the cap is reached", () => {
    expect(describeUsage(detail(false))).toBe(
      "Model spend USD 20.00; machine time 10.0 h of 10 h (set for this user) in 2026-10.",
    );
    expect(describeUsage(detail(true))).toMatch(/Machine-hour cap reached\.$/);
  });
});

describe("admin tools summary", () => {
  it("is absent without Tier 0 tools", () => {
    expect(describeToolsUsage({})).toBeNull();
    expect(toolsCapReached({})).toBe(false);
  });
  it("shows web spend in fractions of a cent, proxy GB, overrides and the cap", () => {
    const tools = {
      month: "2026-10",
      web: { capUsd: 5, override: false, spentUsd: 0.0147, calls: 3, capReached: false },
      proxy: { mode: "relay" as const, capGb: 1, override: true, usedGb: 0.25, capReached: false },
    };
    expect(describeToolsUsage({ tools })).toBe(
      "Web tools USD 0.0147 of USD 5.00 (3 calls); proxy 0.25 GB of 1 GB (set for this user).",
    );
    const capped = { ...tools, web: { ...tools.web, calls: 1, capReached: true } };
    expect(describeToolsUsage({ tools: capped })).toMatch(
      /\(1 call\);.*Cap reached: web tools stopped until next month\.$/,
    );
    expect(toolsCapReached({ tools: capped })).toBe(true);
    expect(describeToolsUsage({ tools: { ...tools, proxy: null } })).toBe(
      "Web tools USD 0.0147 of USD 5.00 (3 calls).",
    );
  });
});

describe("my usage this month", () => {
  const me: Pick<UserDetail, "limits" | "usage"> = {
    limits: {
      openrouterMonthlyUsd: 50,
      openrouterOverride: false,
      machineHoursPerMonth: 40,
      machineHoursOverride: false,
    },
    usage: {
      month: "2026-10",
      machineHours: 3.25,
      machineHoursCapReached: false,
      openrouterKey: true,
    },
  };
  it("shows model and machine time without Tier 0 tools", () => {
    expect(myUsageRows(me).map((r) => [r.label, r.value, r.capReached])).toEqual([
      ["Model spend", "Up to USD 50.00", false],
      ["Machine time", "3.3 h of 40 h", false],
    ]);
  });
  it("adds web tools and proxy traffic with their caps", () => {
    const rows = myUsageRows({
      ...me,
      tools: {
        month: "2026-10",
        web: { capUsd: 5, override: false, spentUsd: 5, calls: 1, capReached: true },
        proxy: {
          mode: "subuser",
          capGb: null,
          override: false,
          usedGb: 0.0000042,
          capReached: false,
        },
      },
    });
    expect(rows.slice(2).map((r) => [r.key, r.value, r.capReached])).toEqual([
      ["web", "USD 5.00 of USD 5.00 (1 call)", true],
      ["proxy", "0 GB of No limit", false],
    ]);
  });
});

describe("admin instance tools line", () => {
  const view = {
    month: "2026-10",
    search: { provider: "exa" },
    fetch: { provider: "scrapingbee" },
    proxy: { provider: "evomi", mode: "relay" as const },
    web: { spentUsd: 0.25, calls: 40, capUsd: 100, capReached: false },
    proxyUsedGb: 1.25,
  };
  it("is null when nothing is configured", () => {
    expect(describeToolsAdmin({ ...view, search: null, fetch: null, proxy: null })).toBeNull();
  });
  it("names the providers and the instance's totals", () => {
    expect(describeToolsAdmin(view)).toBe(
      "Providers: search exa, fetching scrapingbee, proxy evomi (relayed). Everyone's web tools USD 0.2500 of USD 100.00 (40 calls) in 2026-10. Proxy traffic 1.25 GB.",
    );
    expect(describeToolsAdmin({ ...view, web: { ...view.web, capReached: true } })).toMatch(
      /Instance cap reached/,
    );
  });
});

describe("suggest for everyone", () => {
  const suggestion = (patch: Partial<SuggestionView>): SuggestionView => ({
    id: "s1",
    userId: "u1",
    userEmail: "a@example.org",
    byUserId: "u1",
    kind: "skill",
    name: "invoices",
    title: "t",
    number: 7,
    url: "https://github.example/pr/7",
    state: "open",
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
    checkedAt: "2026-10-10T00:00:00.000Z",
    ...patch,
  });
  it("finds the open suggestion of a target only", () => {
    const list = [
      suggestion({ id: "a", state: "merged" }),
      suggestion({ id: "b" }),
      suggestion({ id: "c", kind: "instructions", name: "" }),
      suggestion({ id: "d", kind: "note", name: "n1", state: "closed" }),
    ];
    expect(openSuggestionFor(list, { kind: "skill", name: "invoices" })?.id).toBe("b");
    expect(openSuggestionFor(list, { kind: "skill", name: "other" })).toBeNull();
    expect(openSuggestionFor(list, { kind: "instructions" })?.id).toBe("c");
    expect(openSuggestionFor(list, { kind: "note", noteId: "n1" })).toBeNull();
  });
  it("labels states and targets", () => {
    expect(presentSuggestion({ state: "open" })).toEqual({
      label: "Waiting for an admin",
      tone: "busy",
    });
    expect(presentSuggestion({ state: "merged" }).tone).toBe("ok");
    expect(presentSuggestion({ state: "closed" }).label).toBe("Closed");
    expect(suggestionTargetLabel({ kind: "skill", name: "invoices" })).toBe('Skill "invoices"');
    expect(suggestionTargetLabel({ kind: "note", name: "n1" })).toBe("A note");
  });
  it("offers an archive download for archived tasks only", () => {
    expect(canDownloadArchive({ state: "archived" })).toBe(true);
    expect(canDownloadArchive({ state: "paused" })).toBe(false);
  });
});

describe("signing out", () => {
  it("tells a revoked device from an account without access", () => {
    expect(
      signOutReason(errorFromResponse(403, { error: { code: "device_revoked", message: "x" } })),
    ).toBe("revoked");
    expect(
      signOutReason(errorFromResponse(403, { error: { code: "forbidden", message: "x" } })),
    ).toBe("no_access");
    expect(signOutReason(new Jarvis3Error("You're signed out.", 401, "signed_out"))).toBe(
      "signed_out",
    );
    expect(
      signOutReason(errorFromResponse(401, { error: { code: "unauthenticated", message: "x" } })),
    ).toBe("signed_out");
    expect(signOutReason(errorFromResponse(404, null))).toBeNull();
    expect(signOutReason(new Error("boom"))).toBeNull();
  });
  it("says what to do", () => {
    expect(signOutMessage("revoked")).toMatch(/Sign in again/);
    expect(signOutMessage("no_access")).toMatch(/admin/);
    expect(
      errorFromResponse(403, { error: { code: "device_revoked", message: "x" } }).message,
    ).toBe("This device was signed out. Sign in again.");
  });
});

describe("noticesLabel", () => {
  it("shows the unread count only when there is one", () => {
    expect(noticesLabel(0)).toBe("Notices");
    expect(noticesLabel(3)).toBe("Notices (3)");
    expect(noticesLabel(250)).toBe("Notices (99+)");
  });
});
