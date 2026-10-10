import { describe, expect, it, vi } from "vitest";
import { createJarvis3Api } from "./api";
import type { ApprovalView } from "./api-types";
import {
  approvalPageUrl,
  approvalReturnUrl,
  approvalsLabel,
  approvalStateLabel,
  buildDecideRequest,
  createApprovalsStore,
  mergeApproval,
  passkeysPageUrl,
  splitQueue,
} from "./approvals";
import { Jarvis3Error } from "./plan";

function approval(patch: Partial<ApprovalView> = {}): ApprovalView {
  return {
    id: "a1",
    taskId: "t1",
    taskTitle: "Task",
    user: { id: "u1", email: "alice@example.org", name: "Alice" },
    kind: "action",
    approver: "self",
    state: "pending",
    action: "company_email",
    preview: { summary: "Send an email", fields: [], body: null },
    reason: "",
    options: null,
    changeHash: null,
    decision: null,
    result: null,
    error: null,
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-10T10:00:00.000Z",
    canDecide: true,
    decideWith: "tap",
    ...patch,
  };
}

describe("approvals: presentation and the queue", () => {
  it("labels the navigation with the pending count", () => {
    expect(approvalsLabel(0)).toBe("Approvals");
    expect(approvalsLabel(3)).toBe("Approvals (3)");
    expect(approvalsLabel(120)).toBe("Approvals (99+)");
  });

  it("names an approved question and access request by what happened", () => {
    expect(approvalStateLabel(approval({ state: "approved", kind: "question" })).label).toBe(
      "Answered",
    );
    expect(approvalStateLabel(approval({ state: "approved", kind: "access" })).label).toBe(
      "Granted",
    );
    expect(approvalStateLabel(approval({ state: "failed" })).tone).toBe("error");
  });

  it("puts what the caller can decide first, oldest first, then the rest newest first", () => {
    const list = [
      approval({ id: "new-pending", createdAt: "2026-10-10T12:00:00.000Z" }),
      approval({ id: "old-pending", createdAt: "2026-10-10T09:00:00.000Z" }),
      approval({ id: "not-mine", canDecide: false, updatedAt: "2026-10-10T08:00:00.000Z" }),
      approval({ id: "done", state: "done", updatedAt: "2026-10-10T13:00:00.000Z" }),
    ];
    const { pending, recent } = splitQueue(list);
    expect(pending.map((a) => a.id)).toEqual(["old-pending", "new-pending"]);
    expect(recent.map((a) => a.id)).toEqual(["done", "not-mine"]);
  });

  it("keeps the newer copy when merging", () => {
    const decided = approval({ state: "approved", updatedAt: "2026-10-10T11:00:00.000Z" });
    expect(mergeApproval([decided], approval())[0]?.state).toBe("approved");
    expect(mergeApproval([approval()], decided)[0]?.state).toBe("approved");
    expect(mergeApproval([], decided)).toEqual([decided]);
  });
});

describe("approvals: building a decision", () => {
  it("approves an action with one tap and denies with an optional note", () => {
    expect(buildDecideRequest(approval(), { decision: "approve" })).toEqual({
      ok: true,
      request: { decision: "approve" },
    });
    expect(buildDecideRequest(approval(), { decision: "deny", note: "  not now " })).toEqual({
      ok: true,
      request: { decision: "deny", note: "not now" },
    });
    expect(buildDecideRequest(approval(), { decision: "deny", note: "  " })).toEqual({
      ok: true,
      request: { decision: "deny" },
    });
  });

  it("needs an answer for a question", () => {
    const question = approval({ kind: "question", options: ["Yes", "No"] });
    expect(buildDecideRequest(question, { decision: "approve", note: " " }).ok).toBe(false);
    expect(buildDecideRequest(question, { decision: "approve", note: "Yes" })).toEqual({
      ok: true,
      request: { decision: "approve", note: "Yes" },
    });
  });

  it("needs a scope for an access grant", () => {
    const access = approval({ kind: "access", approver: "admin" });
    expect(buildDecideRequest(access, { decision: "approve" }).ok).toBe(false);
    expect(buildDecideRequest(access, { decision: "approve", grantScope: "role" })).toEqual({
      ok: true,
      request: { decision: "approve", grantScope: "role" },
    });
  });

  it("sends a Tier 3 approval to the passkey page, but denies with a tap", () => {
    const tier3 = approval({ approver: "owner", decideWith: "passkey", changeHash: "ab12" });
    expect(buildDecideRequest(tier3, { decision: "approve" }).ok).toBe(false);
    expect(buildDecideRequest(tier3, { decision: "deny" })).toEqual({
      ok: true,
      request: { decision: "deny" },
    });
  });

  it("refuses what the caller can't decide now", () => {
    expect(buildDecideRequest(approval({ canDecide: false }), { decision: "approve" }).ok).toBe(
      false,
    );
    expect(buildDecideRequest(approval({ state: "denied" }), { decision: "deny" }).ok).toBe(false);
  });
});

describe("approvals: server pages", () => {
  it("returns to an app path on the web and to the app's URL on iOS", () => {
    expect(approvalReturnUrl({ platform: "web", scheme: "jarvis3", approvalId: "a 1" })).toBe(
      "/approvals/a%201",
    );
    expect(approvalReturnUrl({ platform: "ios", scheme: "jarvis3", approvalId: "a1" })).toBe(
      "jarvis3://approvals/a1",
    );
    expect(approvalPageUrl("https://i.example.org", "a1", "jarvis3://approvals/a1")).toBe(
      "https://i.example.org/api/pages/approvals/a1?return=jarvis3%3A%2F%2Fapprovals%2Fa1",
    );
    expect(passkeysPageUrl("https://i.example.org", "/approvals")).toBe(
      "https://i.example.org/api/pages/passkeys?return=%2Fapprovals",
    );
  });

  it("calls the approvals routes", async () => {
    const calls: [string, RequestInit][] = [];
    const api = createJarvis3Api({
      baseUrl: () => "https://i.example.org",
      authHeaders: () => null,
      credentials: "include",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push([url, init]);
        return {
          ok: true,
          status: 200,
          url,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ approvals: [] }),
        } as Response;
      }) as unknown as typeof fetch,
    });
    await api.listApprovals();
    await api.listApprovals({ pending: true, taskId: "t 1" });
    await api.getApproval("a/1");
    await api.decideApproval("a1", { decision: "approve", grantScope: "task" });
    expect(calls.map(([url]) => url)).toEqual([
      "https://i.example.org/api/approvals",
      "https://i.example.org/api/approvals?pending=1&taskId=t+1",
      "https://i.example.org/api/approvals/a%2F1",
      "https://i.example.org/api/approvals/a1/decide",
    ]);
    expect(calls[3]?.[1].method).toBe("POST");
    expect(JSON.parse(String(calls[3]?.[1].body))).toEqual({
      decision: "approve",
      grantScope: "task",
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<Parameters<typeof createApprovalsStore>[0]> = {}) {
  const refreshMe = vi.fn(async () => undefined);
  const api = {
    listApprovals: vi.fn(async () => ({ approvals: [approval()] })),
    getApproval: vi.fn(async () => approval()),
    decideApproval: vi.fn(async () =>
      approval({ state: "approved", canDecide: false, updatedAt: "2026-10-10T10:05:00.000Z" }),
    ),
    ...overrides,
  };
  const store = createApprovalsStore(api, { refreshMe });
  return { store, api, refreshMe };
}

describe("approvals store", () => {
  it("changes nothing until the server answers, then shows its answer everywhere", async () => {
    const answer = deferred<ApprovalView>();
    const { store, refreshMe } = setup({ decideApproval: vi.fn(() => answer.promise) });
    await store.loadQueue();
    await store.load("a1");
    await store.loadForTask("t1");
    expect(store.get().pendingByTask.t1).toHaveLength(1);

    const deciding = store.decide(approval(), { decision: "approve" });
    expect(store.get().deciding.a1).toBe(true);
    expect(store.get().byId.a1?.state).toBe("pending");
    expect(store.get().approvals[0]?.state).toBe("pending");

    answer.resolve(
      approval({ state: "executing", canDecide: false, updatedAt: "2026-10-10T10:05:00.000Z" }),
    );
    expect(await deciding).toBe(true);
    expect(store.get().deciding.a1).toBeUndefined();
    expect(store.get().byId.a1?.state).toBe("executing");
    expect(store.get().approvals[0]?.state).toBe("executing");
    expect(store.get().pendingByTask.t1).toEqual([]);
    expect(refreshMe).toHaveBeenCalledTimes(1);
  });

  it("keeps a refusal inline and shows the approval's current state", async () => {
    const { store, api } = setup({
      decideApproval: vi.fn(async () => {
        throw new Jarvis3Error("this request is already approved", 409, "conflict");
      }),
      getApproval: vi.fn(async () =>
        approval({ state: "approved", canDecide: false, updatedAt: "2026-10-10T10:01:00.000Z" }),
      ),
    });
    expect(await store.decide(approval(), { decision: "approve" })).toBe(false);
    expect(store.get().decideErrors.a1).toBe("this request is already approved");
    expect(store.get().deciding.a1).toBeUndefined();
    await vi.waitFor(() => expect(store.get().byId.a1?.state).toBe("approved"));
    expect(api.getApproval).toHaveBeenCalledWith("a1");
    store.clearDecideError("a1");
    expect(store.get().decideErrors.a1).toBeUndefined();
  });

  it("checks the form before a round trip", async () => {
    const { store, api } = setup();
    const question = approval({ kind: "question" });
    expect(await store.decide(question, { decision: "approve", note: "" })).toBe(false);
    expect(api.decideApproval).not.toHaveBeenCalled();
    expect(store.get().decideErrors.a1).toBe("Write an answer first.");
  });

  it("sends one decision at a time per approval", async () => {
    const answer = deferred<ApprovalView>();
    const decideApproval = vi.fn(() => answer.promise);
    const { store } = setup({ decideApproval });
    const first = store.decide(approval(), { decision: "approve" });
    expect(await store.decide(approval(), { decision: "deny" })).toBe(false);
    answer.resolve(approval({ state: "approved", updatedAt: "2026-10-10T10:05:00.000Z" }));
    await first;
    expect(decideApproval).toHaveBeenCalledTimes(1);
  });

  it("doesn't let a list that was in flight undo a decision", async () => {
    const list = deferred<{ approvals: ApprovalView[] }>();
    const { store } = setup({ listApprovals: vi.fn(() => list.promise) });
    const loading = store.loadQueue();
    await store.decide(approval(), { decision: "approve" });
    list.resolve({ approvals: [approval()] });
    await loading;
    expect(store.get().approvals[0]?.state).toBe("approved");
  });

  it("shows a load error per approval", async () => {
    const { store } = setup({
      getApproval: vi.fn(async () => {
        throw new Jarvis3Error("not found", 404, "not_found");
      }),
    });
    await store.load("zz");
    expect(store.get().loadErrors.zz).toBe("not found");
  });
});
