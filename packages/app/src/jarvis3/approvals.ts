// Approvals (docs/API.md "approvals" in DE0CH/jarvis3): what an agent asked to do, waiting for a
// person. Pure decisions plus the store the approvals screens and the task chat share; unit-tested
// in approvals.test.ts. No React Native here.
import type { Jarvis3Api } from "./api";
import type { ApprovalLevel, ApprovalState, ApprovalView, DecideRequest } from "./api-types";
import type { Tone } from "./plan";

// ---- presentation ---------------------------------------------------------------------------

const STATE: Record<ApprovalState, { label: string; tone: Tone }> = {
  pending: { label: "Waiting for a decision", tone: "busy" },
  approved: { label: "Approved", tone: "ok" },
  executing: { label: "Running", tone: "busy" },
  done: { label: "Done", tone: "ok" },
  failed: { label: "Failed", tone: "error" },
  denied: { label: "Denied", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

const ANSWERED = { label: "Answered", tone: "ok" } as const;
const GRANTED = { label: "Granted", tone: "ok" } as const;

export function approvalStateLabel(approval: ApprovalView): { label: string; tone: Tone } {
  if (approval.state === "approved" && approval.kind === "question") return ANSWERED;
  if (approval.state === "approved" && approval.kind === "access") return GRANTED;
  return STATE[approval.state];
}

/** What the decision was, whatever happened after it: "Approved", "Denied", "Answered", "Granted". */
export function decisionVerb(approval: ApprovalView): string {
  if (approval.state === "denied") return "Denied";
  if (approval.kind === "question") return "Answered";
  if (approval.kind === "access") return "Granted";
  return "Approved";
}

const KIND: Record<ApprovalView["kind"], string> = {
  action: "Action",
  guard: "Command",
  access: "Access request",
  question: "Question",
};

export function approvalKindLabel(approval: ApprovalView): string {
  return KIND[approval.kind];
}

const APPROVER: Record<ApprovalLevel, string> = {
  auto: "Allowed by policy",
  self: "The chat's owner",
  admin: "An admin",
  owner: "The instance's owner, with a passkey",
};

export function approverLabel(level: ApprovalLevel): string {
  return APPROVER[level];
}

/** Who asked: the task's owner, by name when known. */
export function askedBy(approval: ApprovalView): string {
  return approval.user.name || approval.user.email;
}

/** "Approvals (3)" in the navigation. */
export function approvalsLabel(pending: number): string {
  return pending > 0 ? `Approvals (${pending > 99 ? "99+" : pending})` : "Approvals";
}

// ---- the queue ------------------------------------------------------------------------------

export function isDecidableNow(approval: ApprovalView): boolean {
  return approval.state === "pending" && approval.canDecide;
}

/** Pending-for-me first (oldest first: who has waited longest), then the rest, newest first. */
export function splitQueue(approvals: ApprovalView[]): {
  pending: ApprovalView[];
  recent: ApprovalView[];
} {
  const pending = approvals
    .filter(isDecidableNow)
    .slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const recent = approvals
    .filter((approval) => !isDecidableNow(approval))
    .slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { pending, recent };
}

/** Puts `next` into the list, unless the list already has a newer copy of it. */
export function mergeApproval(list: ApprovalView[], next: ApprovalView): ApprovalView[] {
  const index = list.findIndex((approval) => approval.id === next.id);
  if (index < 0) return [next, ...list];
  const current = list[index];
  if (current && current.updatedAt > next.updatedAt) return list;
  return list.map((approval, i) => (i === index ? next : approval));
}

// ---- deciding -------------------------------------------------------------------------------

export type DecideInput =
  | { decision: "approve"; note?: string; grantScope?: "task" | "role" }
  | { decision: "deny"; note?: string };

/**
 * The request to send for a decision, or why it can't be sent. Mirrors the server's rules, so the
 * form says what is missing before a round trip: a Tier 3 approval needs the passkey page, a
 * question needs an answer, an access grant needs its scope.
 */
export function buildDecideRequest(
  approval: ApprovalView,
  input: DecideInput,
): { ok: true; request: DecideRequest } | { ok: false; message: string } {
  if (!isDecidableNow(approval)) {
    return { ok: false, message: "This request can't be decided from here any more." };
  }
  const note = input.note?.trim() ?? "";
  if (input.decision === "deny") {
    return { ok: true, request: { decision: "deny", ...(note ? { note } : {}) } };
  }
  if (approval.decideWith === "passkey") {
    return { ok: false, message: "Approve this change with Face ID (the passkey page)." };
  }
  if (approval.kind === "question") {
    if (!note) return { ok: false, message: "Write an answer first." };
    return { ok: true, request: { decision: "approve", note } };
  }
  if (approval.kind === "access") {
    if (input.grantScope !== "task" && input.grantScope !== "role") {
      return { ok: false, message: "Choose who gets the access." };
    }
    return { ok: true, request: { decision: "approve", grantScope: input.grantScope } };
  }
  return { ok: true, request: { decision: "approve", ...(note ? { note } : {}) } };
}

// ---- server pages (Tier 3 passkey approval, passkey setup) -----------------------------------

/** Where the passkey page sends the user back to: an app path on the web, the app's URL on iOS. */
export function approvalReturnUrl(input: {
  platform: string;
  scheme: string;
  approvalId: string;
}): string {
  const path = `approvals/${encodeURIComponent(input.approvalId)}`;
  return input.platform === "web" ? `/${path}` : `${input.scheme}://${path}`;
}

export function approvalPageUrl(instanceUrl: string, approvalId: string, ret: string): string {
  return `${instanceUrl}/api/pages/approvals/${encodeURIComponent(approvalId)}?return=${encodeURIComponent(ret)}`;
}

export function passkeysPageUrl(instanceUrl: string, ret: string): string {
  return `${instanceUrl}/api/pages/passkeys?return=${encodeURIComponent(ret)}`;
}

// ---- the store ------------------------------------------------------------------------------

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ApprovalsState {
  /** The queue (GET /api/approvals): everything the caller may see, newest first. */
  loaded: boolean;
  approvals: ApprovalView[];
  error: string | null;
  /** Approvals opened one by one (the detail screen). */
  byId: Record<string, ApprovalView>;
  loadErrors: Record<string, string>;
  /** Decisions in flight, and the last refusal per approval (shown inline on its page). */
  deciding: Record<string, true>;
  decideErrors: Record<string, string>;
  /** taskId -> what that task waits on from the caller (the chat's inline notice). */
  pendingByTask: Record<string, ApprovalView[]>;
}

/** How often the task chat looks for new pending approvals of its task. */
export const REFRESH_TASK_APPROVALS_MS = 15_000;

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _gone, ...rest } = record;
  return rest;
}

export function createApprovalsStore(
  api: Pick<Jarvis3Api, "listApprovals" | "getApproval" | "decideApproval">,
  account: { refreshMe: () => Promise<void> },
) {
  let state: ApprovalsState = {
    loaded: false,
    approvals: [],
    error: null,
    byId: {},
    loadErrors: {},
    deciding: {},
    decideErrors: {},
    pendingByTask: {},
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ApprovalsState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  /** Records a fresh copy of one approval everywhere it is shown. */
  function put(approval: ApprovalView): void {
    const current = state.byId[approval.id];
    if (current && current.updatedAt > approval.updatedAt) return;
    const pendingByTask = { ...state.pendingByTask };
    for (const [taskId, list] of Object.entries(pendingByTask)) {
      if (list.some((a) => a.id === approval.id)) {
        pendingByTask[taskId] = isDecidableNow(approval)
          ? list.map((a) => (a.id === approval.id ? approval : a))
          : list.filter((a) => a.id !== approval.id);
      }
    }
    set({
      byId: { ...state.byId, [approval.id]: approval },
      approvals: state.loaded ? mergeApproval(state.approvals, approval) : state.approvals,
      pendingByTask,
    });
  }

  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async loadQueue(): Promise<void> {
      try {
        const { approvals } = await api.listApprovals();
        // A decision that landed while the list was in flight is newer than the list's copy.
        const fresh = approvals.map((a) => {
          const known = state.byId[a.id];
          return known && known.updatedAt > a.updatedAt ? known : a;
        });
        set({ loaded: true, approvals: fresh, error: null });
      } catch (error) {
        set({ loaded: true, error: messageOf(error) });
      }
    },
    async load(approvalId: string): Promise<void> {
      try {
        const approval = await api.getApproval(approvalId);
        set({ loadErrors: without(state.loadErrors, approvalId) });
        put(approval);
      } catch (error) {
        set({ loadErrors: { ...state.loadErrors, [approvalId]: messageOf(error) } });
      }
    },
    async loadForTask(taskId: string): Promise<void> {
      try {
        const { approvals } = await api.listApprovals({ pending: true, taskId });
        set({
          pendingByTask: { ...state.pendingByTask, [taskId]: approvals.filter(isDecidableNow) },
        });
      } catch {
        // The chat's notice is a hint; the approvals screen shows errors.
      }
    },
    /**
     * Sends a decision and waits for the server's answer (no optimistic update). Returns whether
     * it was recorded; a refusal is kept in decideErrors for the page to show.
     */
    async decide(approval: ApprovalView, input: DecideInput): Promise<boolean> {
      if (state.deciding[approval.id]) return false;
      const built = buildDecideRequest(approval, input);
      if (!built.ok) {
        set({ decideErrors: { ...state.decideErrors, [approval.id]: built.message } });
        return false;
      }
      set({
        deciding: { ...state.deciding, [approval.id]: true },
        decideErrors: without(state.decideErrors, approval.id),
      });
      try {
        const next = await api.decideApproval(approval.id, built.request);
        set({ deciding: without(state.deciding, approval.id) });
        put(next);
        void account.refreshMe();
        return true;
      } catch (error) {
        set({
          deciding: without(state.deciding, approval.id),
          decideErrors: { ...state.decideErrors, [approval.id]: messageOf(error) },
        });
        // Someone else may have decided it meanwhile: show its current state.
        void api
          .getApproval(approval.id)
          .then(put)
          .catch(() => undefined);
        return false;
      }
    },
    clearDecideError(approvalId: string) {
      if (state.decideErrors[approvalId]) {
        set({ decideErrors: without(state.decideErrors, approvalId) });
      }
    },
  };
}

export type ApprovalsStore = ReturnType<typeof createApprovalsStore>;
