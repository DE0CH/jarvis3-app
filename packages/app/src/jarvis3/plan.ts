// Pure decisions for the Jarvis 3 screens (unit-tested in plan.test.ts). No React Native here.
import type {
  ApiError,
  ErrorCode,
  PersonalLayerView,
  SuggestionView,
  TaskState,
  TaskView,
  UserDetail,
} from "./api-types";

// ---- instance URL -----------------------------------------------------------------------

/** On the web the app is served by the instance itself, so the page's origin is the instance. */
export function resolveInstanceUrl(input: {
  platform: string;
  extraUrl: string | null | undefined;
  origin: string | null | undefined;
}): string | null {
  if (input.platform === "web") return input.origin ? stripSlash(input.origin) : null;
  return input.extraUrl ? stripSlash(input.extraUrl) : null;
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

// ---- tasks ------------------------------------------------------------------------------

export type Tone = "ok" | "busy" | "idle" | "error" | "muted";

export interface TaskPresentation {
  label: string;
  tone: Tone;
  canOpen: boolean;
  canResume: boolean;
  canPause: boolean;
  /** A short explanation shown under the title, or null. */
  detail: string | null;
}

const PAUSED_REASON: Record<NonNullable<TaskView["pausedReason"]>, string> = {
  user: "Paused",
  idle: "Paused after being idle",
  machine_hours_cap: "Paused: your monthly machine hours are used up",
  instance_budget: "Paused: the organisation's monthly budget is used up",
  offboarded: "Paused: access was removed",
};

export function presentTask(task: TaskView): TaskPresentation {
  const busy = task.busy !== null;
  const base: TaskPresentation = {
    label: stateLabel(task.state),
    tone: "muted",
    canOpen: false,
    canResume: false,
    canPause: false,
    detail: task.error,
  };
  switch (task.state) {
    case "starting":
      return {
        ...base,
        tone: "busy",
        label: busy && task.busy?.kind === "resuming" ? "Resuming…" : "Starting…",
      };
    case "running":
      return { ...base, tone: "ok", canOpen: task.connected, canPause: !busy };
    case "idle":
      return { ...base, tone: "idle", canOpen: task.connected, canPause: !busy };
    case "pausing":
      return { ...base, tone: "busy" };
    case "paused":
      return {
        ...base,
        tone: "muted",
        label: task.pausedReason ? PAUSED_REASON[task.pausedReason] : "Paused",
        canResume: !busy && task.pausedReason !== "offboarded",
      };
    case "destroying":
      return { ...base, tone: "busy" };
    case "archived":
      return { ...base, tone: "muted" };
    case "failed":
      return { ...base, tone: "error" };
  }
}

function stateLabel(state: TaskState): string {
  switch (state) {
    case "starting":
      return "Starting…";
    case "running":
      return "Working";
    case "idle":
      return "Waiting for you";
    case "pausing":
      return "Pausing…";
    case "paused":
      return "Paused";
    case "destroying":
      return "Deleting…";
    case "archived":
      return "Archived";
    case "failed":
      return "Could not start";
  }
}

/** Whether the list should be fetched again soon: something is changing state. */
export function taskListNeedsRefresh(tasks: readonly TaskView[]): boolean {
  return tasks.some(
    (task) =>
      task.busy !== null ||
      task.state === "starting" ||
      task.state === "pausing" ||
      task.state === "destroying" ||
      ((task.state === "running" || task.state === "idle") && !task.connected),
  );
}

/** The list shown to the user: archived tasks last, otherwise the server's order (newest first). */
export function orderTasks(tasks: readonly TaskView[]): TaskView[] {
  const live = tasks.filter((task) => task.state !== "archived");
  const archived = tasks.filter((task) => task.state === "archived");
  return [...live, ...archived];
}

/** Replaces (or adds at the top) one task in a list, keeping the order otherwise. */
export function mergeTask(tasks: readonly TaskView[], task: TaskView): TaskView[] {
  const index = tasks.findIndex((existing) => existing.id === task.id);
  if (index < 0) return [task, ...tasks];
  const next = tasks.slice();
  next[index] = task;
  return next;
}

// ---- the task's chat --------------------------------------------------------------------

/**
 * The agent a task's chat shows: the one the session reported as the task's own
 * (`TaskView.agentId`), once the task's host has it. null while either is missing.
 */
export function taskAgentOnHost(
  task: Pick<TaskView, "agentId"> | null,
  hostAgentIds: readonly string[],
): string | null {
  const id = task?.agentId ?? null;
  return id && hostAgentIds.includes(id) ? id : null;
}

// ---- errors -----------------------------------------------------------------------------

export class Jarvis3Error extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ErrorCode | "signed_out" | "network",
  ) {
    super(message);
    this.name = "Jarvis3Error";
  }
}

const FRIENDLY: Partial<Record<ErrorCode, string>> = {
  machine_hours_cap:
    "Your machine hours for this month are used up. Ask your admin to raise your limit.",
  instance_budget: "The organisation's monthly budget is used up. Ask your admin.",
  tools_cap: "This month's web-tools allowance is used up. Ask your admin to raise your limit.",
  too_many_requests: "Too many attempts. Try again in a minute.",
  upstream: "A provider didn't answer. Try again shortly.",
  unavailable: "The task isn't connected yet.",
  forbidden: "This account has no access to this instance.",
  device_revoked: "This device was signed out. Sign in again.",
  unauthenticated: "You're signed out.",
};

/** Turns an HTTP answer's status and body into a Jarvis3Error with a message fit to show. */
export function errorFromResponse(status: number, body: unknown): Jarvis3Error {
  const parsed = isApiError(body) ? body.error : null;
  const code: ErrorCode = parsed?.code ?? codeForStatus(status);
  const fallback = parsed?.message ?? `Request failed (${status}).`;
  const message = FRIENDLY[code] ?? (code === "not_found" ? "Not found." : fallback);
  if (code === "conflict" || code === "busy" || code === "bad_request") {
    return new Jarvis3Error(parsed?.message ? capitalise(parsed.message) : message, status, code);
  }
  return new Jarvis3Error(message, status, code);
}

function codeForStatus(status: number): ErrorCode {
  if (status === 404) return "not_found";
  if (status >= 500) return "internal";
  return "bad_request";
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isApiError(body: unknown): body is ApiError {
  if (!body || typeof body !== "object") return false;
  const error = (body as { error?: unknown }).error;
  return (
    !!error &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

/**
 * Cloudflare Access answers a refused or expired credential with a redirect to its login page
 * (HTML), not with the API's JSON. Treat that as signed out.
 */
export function isAccessRefusal(input: {
  finalUrl: string;
  status: number;
  contentType: string | null;
}): boolean {
  if (/\/cdn-cgi\/access\/login|cloudflareaccess\.com/.test(input.finalUrl)) return true;
  if (input.status === 302 || input.status === 303) return true;
  return input.status === 200 && !!input.contentType && input.contentType.includes("text/html");
}

// ---- device pairing (iOS) -----------------------------------------------------------------

export type PairAnswer =
  | { status: "paired"; id: string; clientId: string; clientSecret: string }
  | { status: "error"; error: string; httpStatus: string | null };

/** Reads `<scheme>://paired?state=…&id=…&clientId=…&clientSecret=…` (or `…&error=…&status=…`). */
export function parsePairRedirect(url: string, expectedState: string): PairAnswer {
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const params = new URLSearchParams(query.split("#")[0]);
  if (params.get("state") !== expectedState) {
    return {
      status: "error",
      error: "The sign-in answer didn't match this request. Try again.",
      httpStatus: null,
    };
  }
  const error = params.get("error");
  if (error) return { status: "error", error, httpStatus: params.get("status") };
  const id = params.get("id");
  const clientId = params.get("clientId");
  const clientSecret = params.get("clientSecret");
  if (!id || !clientId || !clientSecret) {
    return {
      status: "error",
      error: "The sign-in answer was incomplete. Try again.",
      httpStatus: null,
    };
  }
  return { status: "paired", id, clientId, clientSecret };
}

export function pairErrorMessage(answer: Extract<PairAnswer, { status: "error" }>): string {
  if (answer.httpStatus === "429") return "One sign-in every 30 seconds. Try again shortly.";
  if (answer.httpStatus === "403") return "This account has no access to this instance.";
  return answer.error;
}

// ---- personal layer -----------------------------------------------------------------------

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SKILL_PATH_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const SKILL_MAX_BYTES = 256 * 1024;
export const INSTRUCTIONS_MAX = 64_000;

/** Why a skill can't be saved, or null when it can (the server's rules, checked before sending). */
export function validateSkill(name: string, files: Record<string, string>): string | null {
  if (!SKILL_NAME_RE.test(name)) {
    return "Skill names use lowercase letters, digits and dashes, and start with a letter or digit.";
  }
  const paths = Object.keys(files);
  if (paths.length === 0 || paths.length > 50) return "A skill has 1 to 50 files.";
  if (!paths.includes("SKILL.md")) return "A skill needs a SKILL.md file.";
  for (const path of paths) {
    const segments = path.split("/");
    if (
      segments.some(
        (segment) => segment === "." || segment === ".." || !SKILL_PATH_SEGMENT_RE.test(segment),
      )
    ) {
      return `"${path}" isn't a valid file name.`;
    }
  }
  const bytes = paths.reduce(
    (sum, path) => sum + utf8Length(path) + utf8Length(files[path] ?? ""),
    0,
  );
  if (bytes > SKILL_MAX_BYTES) return "A skill's files are limited to 256 KiB in total.";
  return null;
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

export function isLayerEmpty(
  layer: Pick<PersonalLayerView, "instructions" | "skills" | "notes">,
): boolean {
  return layer.instructions.trim() === "" && layer.skills.length === 0 && layer.notes.length === 0;
}

/** Undo is offered while a reset version exists to go back to. */
export function canUndoLayer(layer: Pick<PersonalLayerView, "versions">): boolean {
  return layer.versions.length > 0;
}

// ---- admin --------------------------------------------------------------------------------

/**
 * Reads an admin's limit field: empty = clear the override (role default applies again),
 * otherwise a number ≥ 0.
 */
export function parseLimitInput(
  text: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0)
    return { ok: false, error: "Enter a number of 0 or more, or leave it empty." };
  return { ok: true, value };
}

export function formatLimit(value: number | null, unit: "usd" | "hours" | "gb"): string {
  if (value === null) return "No limit";
  if (unit === "gb") return `${value} GB`;
  return unit === "usd" ? `USD ${value.toFixed(2)}` : `${value} h`;
}

/** Small amounts keep their cents' fractions (web tools cost fractions of a cent per call). */
function formatSpend(usd: number): string {
  return `USD ${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

/**
 * The admin's line on a user's Tier 0 tools this month (web search + fetch spend, proxy traffic),
 * or null when the instance has none.
 */
export function describeToolsUsage(detail: Pick<UserDetail, "tools">): string | null {
  const tools = detail.tools;
  if (!tools || (!tools.web && !tools.proxy)) return null;
  const own = " (set for this user)";
  const parts: string[] = [];
  if (tools.web) {
    const calls = `${tools.web.calls} call${tools.web.calls === 1 ? "" : "s"}`;
    parts.push(
      `Web tools ${formatSpend(tools.web.spentUsd)} of ${formatLimit(tools.web.capUsd, "usd")}${tools.web.override ? own : ""} (${calls})`,
    );
  }
  if (tools.proxy) {
    parts.push(
      `proxy ${Number(tools.proxy.usedGb.toFixed(3))} GB of ${formatLimit(tools.proxy.capGb, "gb")}${tools.proxy.override ? own : ""}`,
    );
  }
  const capped = [
    tools.web?.capReached ? "web tools" : null,
    tools.proxy?.capReached ? "proxy" : null,
  ].filter(Boolean);
  const cap = capped.length
    ? ` Cap reached: ${capped.join(" and ")} stopped until next month.`
    : "";
  return `${parts.join("; ")}.${cap}`;
}

/** Whether a user is at any Tier 0 cap (the "Tools at cap" pill). */
export function toolsCapReached(detail: Pick<UserDetail, "tools">): boolean {
  return !!(detail.tools?.web?.capReached || detail.tools?.proxy?.capReached);
}

/** The admin's one-line summary of a user's model spend and machine time this month. */
export function describeUsage(detail: Pick<UserDetail, "limits" | "usage">): string {
  const { limits, usage } = detail;
  const own = " (set for this user)";
  const model = `Model spend ${formatLimit(limits.openrouterMonthlyUsd, "usd")}${limits.openrouterOverride ? own : ""}`;
  const hours = `machine time ${usage.machineHours.toFixed(1)} h of ${formatLimit(limits.machineHoursPerMonth, "hours")}${limits.machineHoursOverride ? own : ""}`;
  const cap = usage.machineHoursCapReached ? " Machine-hour cap reached: tasks paused." : "";
  return `${model}; ${hours} in ${usage.month}.${cap}`;
}

// ---- "Suggest for everyone" ---------------------------------------------------------------

export type SuggestTarget =
  | { kind: "skill"; name: string }
  | { kind: "instructions" }
  | { kind: "note"; noteId: string };

/** The name a suggestion is recorded under (SuggestionView.name) for a target. */
function targetName(target: SuggestTarget): string {
  if (target.kind === "skill") return target.name;
  if (target.kind === "note") return target.noteId;
  return "";
}

/**
 * The open suggestion for a target, if any: the button then shows "Suggested" with the link
 * instead of opening a second pull request (the server would refuse it).
 */
export function openSuggestionFor(
  suggestions: readonly SuggestionView[],
  target: SuggestTarget,
): SuggestionView | null {
  const name = targetName(target);
  return (
    suggestions.find((s) => s.state === "open" && s.kind === target.kind && s.name === name) ?? null
  );
}

export function presentSuggestion(s: Pick<SuggestionView, "state">): {
  label: string;
  tone: Tone;
} {
  switch (s.state) {
    case "open":
      return { label: "Waiting for an admin", tone: "busy" };
    case "merged":
      return { label: "Accepted", tone: "ok" };
    case "closed":
      return { label: "Closed", tone: "muted" };
  }
}

export function suggestionTargetLabel(s: Pick<SuggestionView, "kind" | "name">): string {
  if (s.kind === "skill") return `Skill "${s.name}"`;
  if (s.kind === "instructions") return "Instructions";
  return "A note";
}

/** An archived task's state can be downloaded (the server answers 409 when none was kept). */
export function canDownloadArchive(task: Pick<TaskView, "state">): boolean {
  return task.state === "archived";
}

// ---- the chat screen's phase --------------------------------------------------------------

export type ChatPhase =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "error"; message: string }
  | { kind: "starting"; label: string }
  | { kind: "paused"; label: string; canResume: boolean }
  | { kind: "closed"; label: string }
  | { kind: "connect" }
  | { kind: "connecting" }
  | { kind: "waiting_agent" }
  | { kind: "chat"; serverId: string; agentId: string };

/**
 * What the task screen shows. `hostServerId` is the Paseo host already made for this task
 * (null until the app has probed the daemon through the proxy), `hostOnline` its connection,
 * `agentId` the task's agent once that host has it (taskAgentOnHost).
 */
export function planTaskChat(input: {
  task: TaskView | null;
  loadError: Jarvis3Error | null;
  hostServerId: string | null;
  hostOnline: boolean;
  agentId: string | null;
}): ChatPhase {
  const { task, loadError } = input;
  if (!task) {
    if (loadError?.code === "not_found") return { kind: "not_found" };
    if (loadError) return { kind: "error", message: loadError.message };
    return { kind: "loading" };
  }
  const view = presentTask(task);
  switch (task.state) {
    case "paused":
      return { kind: "paused", label: view.label, canResume: view.canResume };
    case "pausing":
    case "destroying":
    case "archived":
    case "failed":
      return { kind: "closed", label: view.label };
    case "starting":
      return { kind: "starting", label: view.label };
    case "running":
    case "idle":
      if (!task.connected) return { kind: "starting", label: "Connecting to the task…" };
      if (!input.hostServerId) return { kind: "connect" };
      if (!input.hostOnline) return { kind: "connecting" };
      if (!input.agentId) return { kind: "waiting_agent" };
      return { kind: "chat", serverId: input.hostServerId, agentId: input.agentId };
  }
}

// ---- signed out ---------------------------------------------------------------------------

/**
 * Why the app has no access, from the error that refused it: `revoked` (this device's token was
 * revoked; pair again), `no_access` (the account itself is suspended, removed or unknown) or
 * `signed_out` (no or an expired login). null when the error isn't a refusal.
 */
export type SignOutReason = "revoked" | "no_access" | "signed_out";

export function signOutReason(error: unknown): SignOutReason | null {
  if (!(error instanceof Jarvis3Error)) return null;
  if (error.code === "device_revoked") return "revoked";
  if (error.code === "forbidden") return "no_access";
  if (error.code === "signed_out" || error.code === "unauthenticated") return "signed_out";
  return null;
}

const SIGN_OUT_MESSAGE: Record<SignOutReason, string> = {
  revoked: "This device was signed out of the instance. Sign in again to use it.",
  no_access: "This account has no access to this instance. Ask your admin.",
  signed_out: "You're signed out.",
};

export function signOutMessage(reason: SignOutReason): string {
  return SIGN_OUT_MESSAGE[reason];
}

// ---- notices -------------------------------------------------------------------------------

/** The navigation label for notices: with the unread count when there are any. */
export function noticesLabel(unread: number): string {
  return unread > 0 ? `Notices (${unread > 99 ? "99+" : unread})` : "Notices";
}
