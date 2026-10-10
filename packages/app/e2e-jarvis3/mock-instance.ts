// A mock Jarvis 3 instance for the jarvis3 web e2e (and for local UI work): serves the jarvis3
// web export at its origin, answers the instance API with the shapes of src/jarvis3/api-types.ts
// (vendored from DE0CH/jarvis3), and relays `/api/tasks/:id/daemon` to a real Paseo daemon,
// adding `paseo.bearer.<password>` the way the real server does; `/api/tasks/:id/daemon/http/*`
// relays HTTP to the daemon the same way (bearer added, always a sandboxed download).
//
// Identity stands in for Cloudflare Access: the `CF_Authorization` cookie (or the
// `Cf-Access-Authenticated-User-Email` header) is the user's email, unsigned, and an iOS build
// pairs through `/api/devices/pair` (a mock sign-in page, then `CF-Access-Client-Id/Secret`).
// Approvals follow the server's rules (who may decide, what a decision needs); the passkey pages
// (`/api/pages/approvals/:id`, `/api/pages/passkeys`) are stand-ins with a "mock passkey" link.
// Never deploy this.
//
// Standalone: node --import tsx e2e-jarvis3/mock-instance.ts --dist dist-jarvis3 --port 8090 \
//   [--daemon ws://127.0.0.1:6768/ws --daemon-password …]
import { createReadStream, existsSync, statSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { exampleApprovals } from "./approval-fixtures";
import type {
  ApiError,
  ApprovalView,
  CreateTaskRequest,
  DecideRequest,
  ErrorCode,
  MarkNoticesReadRequest,
  MeView,
  ModelList,
  NoticeView,
  PersonalLayerVersionView,
  PersonalLayerView,
  PersonalNote,
  ResetResult,
  SetLimitsRequest,
  SuggestionView,
  SuggestRequest,
  TaskView,
  UserDetail,
  UserStatus,
} from "../src/jarvis3/api-types";

export interface MockUser {
  id: string;
  email: string;
  name: string;
  role: string;
  isAdmin: boolean;
}

export interface MockDaemonTarget {
  url: string;
  password: string;
  /** The task's own agent on that daemon (reported as TaskView.agentId once the task runs). */
  agentId?: string;
}

type LayerContent = Omit<PersonalLayerView, "versions">;

interface StoredLayer {
  current: LayerContent;
  versions: { view: PersonalLayerVersionView; layer: LayerContent }[];
}

export interface MockInstanceOptions {
  distDir: string | null;
  port?: number;
  users?: MockUser[];
  tasks?: TaskView[];
  /** taskId -> the daemon its proxy reaches. */
  daemons?: Record<string, MockDaemonTarget>;
  /** A created or resumed task becomes running after this long (ms). */
  startDelayMs?: number;
  /** The daemon a newly created task's proxy reaches (none: it never connects). */
  newTaskDaemon?: MockDaemonTarget | null;
  /** userId -> that user's notices, newest first. */
  notices?: Record<string, NoticeView[]>;
  /** The app scheme `/api/devices/pair` redirects to (the server's `devices.appScheme`). */
  appScheme?: string;
  /** userId -> a status other than active (an offboarded person). */
  userStatus?: Record<string, UserStatus>;
  /** Users whose machine-hour cap is reached this month. */
  capReached?: string[];
  /** The instance has Tier 0 tools (web search/fetch and a relayed proxy): UserDetail.tools. */
  tools?: boolean;
  /** Users whose web-tools cap is reached this month. */
  toolsCapReached?: string[];
  /** userId -> a personal layer to start with (an offboarded person's kept layer). */
  layers?: Record<string, LayerContent>;
  /** Approvals, as stored: `canDecide` and `decideWith` are worked out per caller. */
  approvals?: ApprovalView[];
  /** The instance's owner (Tier 3 approvals with a passkey). */
  ownerId?: string;
}

export interface MockInstance {
  url: string;
  port: number;
  state: {
    tasks: TaskView[];
    layers: Map<string, StoredLayer>;
    requests: string[];
    notices: Map<string, NoticeView[]>;
    suggestions: SuggestionView[];
    approvals: ApprovalView[];
  };
  close(): Promise<void>;
}

const MODELS: ModelList = {
  models: [
    { id: "anthropic/claude-example", label: "Claude (example)" },
    { id: "openai/gpt-example", label: "GPT (example)" },
  ],
  default: "anthropic/claude-example",
};

export const DEFAULT_USERS: MockUser[] = [
  { id: "u-alice", email: "alice@example.org", name: "Alice", role: "staff", isAdmin: false },
  { id: "u-bob", email: "bob@example.org", name: "Bob", role: "staff", isAdmin: false },
  { id: "u-admin", email: "admin@example.org", name: "Admin", role: "admin", isAdmin: true },
];

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".map": "application/json",
};

const now = () => new Date().toISOString();

function emptyLayer(): LayerContent {
  return { instructions: "", skills: [], notes: [], updatedAt: null };
}

function isEmpty(layer: LayerContent): boolean {
  return layer.instructions === "" && layer.skills.length === 0 && layer.notes.length === 0;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** One API request: the caller, the path parameters, the body. Handlers return [status, body]. */
interface Ctx {
  user: MockUser;
  params: string[];
  query: URLSearchParams;
  body: () => Promise<unknown>;
}
type Handler = (ctx: Ctx) => [number, unknown] | Promise<[number, unknown]>;
type Route = [method: string, pattern: RegExp, handler: Handler];

function setOverride(previous: number | null, next: number | null | undefined): number | null {
  return next === undefined ? previous : next;
}

export async function startMockInstance(options: MockInstanceOptions): Promise<MockInstance> {
  const users = options.users ?? DEFAULT_USERS;
  const appScheme = options.appScheme ?? "jarvis3";
  const tasks: TaskView[] = (options.tasks ?? []).map((task) => Object.assign({}, task));
  const daemons: Record<string, MockDaemonTarget> = { ...options.daemons };
  const layers = new Map<string, StoredLayer>();
  const limits = new Map<
    string,
    { usd: number | null; hours: number | null; tools?: number | null; proxy?: number | null }
  >();
  const requests: string[] = [];
  const notices = new Map<string, NoticeView[]>(
    Object.entries(options.notices ?? {}).map(([userId, list]) => [
      userId,
      list.map((notice) => Object.assign({}, notice)),
    ]),
  );
  const noticesOf = (userId: string): NoticeView[] => notices.get(userId) ?? [];
  const approvals: ApprovalView[] = (options.approvals ?? []).map((a) => structuredClone(a));
  const ownerId = options.ownerId ?? "u-admin";
  const meOf = (user: MockUser): MeView => ({
    ...detailOf(user),
    unreadNotices: noticesOf(user.id).filter((notice) => !notice.read).length,
    features: { suggestions: true },
    pendingApprovals: approvals.filter((a) => canDecide(user, a)).length,
    isOwner: user.id === ownerId,
  });
  const suggestions: SuggestionView[] = [];
  for (const [userId, content] of Object.entries(options.layers ?? {})) {
    layers.set(userId, { current: structuredClone(content), versions: [] });
  }
  const created = new Map<string, string>(); // `${userId}:${requestId}` -> task id
  const startDelay = options.startDelayMs ?? 1500;
  let counter = 0;

  // ---- state helpers ----

  const layerOf = (userId: string): StoredLayer => {
    let layer = layers.get(userId);
    if (!layer) {
      layer = { current: emptyLayer(), versions: [] };
      layers.set(userId, layer);
    }
    return layer;
  };
  const viewOf = (userId: string): PersonalLayerView => {
    const layer = layerOf(userId);
    return { ...layer.current, versions: layer.versions.map((v) => v.view).toReversed() };
  };
  const detailOf = (user: MockUser): UserDetail => {
    const override = limits.get(user.id) ?? { usd: null, hours: null };
    return {
      user: {
        ...user,
        status: options.userStatus?.[user.id] ?? "active",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
      limits: {
        openrouterMonthlyUsd: override.usd ?? 20,
        openrouterOverride: override.usd !== null,
        machineHoursPerMonth: override.hours ?? 10,
        machineHoursOverride: override.hours !== null,
      },
      usage: {
        month: "2026-10",
        machineHours: options.capReached?.includes(user.id) ? 10 : 1.5,
        machineHoursCapReached: options.capReached?.includes(user.id) ?? false,
        openrouterKey: true,
      },
      ...(options.tools ? { tools: toolsOf(user, override) } : {}),
    };
  };
  const toolsOf = (
    user: MockUser,
    override: { tools?: number | null; proxy?: number | null },
  ): NonNullable<UserDetail["tools"]> => {
    const capUsd = override.tools ?? 5;
    const atCap = options.toolsCapReached?.includes(user.id) ?? false;
    const spentUsd = atCap ? 5 : 0.0147;
    return {
      month: "2026-10",
      web: {
        capUsd,
        override: override.tools != null,
        spentUsd,
        calls: atCap ? 712 : 3,
        capReached: spentUsd >= capUsd,
      },
      proxy: {
        mode: "relay",
        capGb: override.proxy ?? 1,
        override: override.proxy != null,
        usedGb: 0.25,
        capReached: false,
      },
    };
  };
  const touch = (task: TaskView, patch: Partial<TaskView>) =>
    Object.assign(task, patch, { updatedAt: now() });
  const startLater = (task: TaskView) =>
    setTimeout(
      () =>
        touch(task, {
          state: "running",
          busy: null,
          connected: Boolean(daemons[task.id]),
          agentId: daemons[task.id]?.agentId ?? task.agentId,
        }),
      startDelay,
    );
  const ownTask = (user: MockUser, id: string): TaskView => {
    const task = tasks.find((t) => t.id === id && (t.userId === user.id || user.isAdmin));
    if (!task) throw new HttpError(404, "not_found", "no such task");
    return task;
  };
  const userFor = (caller: MockUser, id: string): MockUser => {
    const target = id === "me" ? caller : users.find((u) => u.id === id);
    if (!target || (target.id !== caller.id && !caller.isAdmin)) {
      throw new HttpError(404, "not_found", "not found");
    }
    return target;
  };
  const requireAdmin = (caller: MockUser) => {
    if (!caller.isAdmin) throw new HttpError(404, "not_found", "not found");
  };
  const layerFor = (ctx: Ctx) => {
    const target = userFor(ctx.user, ctx.params[0] ?? "");
    const layer = layerOf(target.id);
    return {
      layer,
      view: () => viewOf(target.id),
      saved: () => {
        layer.current.updatedAt = now();
        return viewOf(target.id);
      },
    };
  };
  const archive = (layer: StoredLayer, reason: "reset" | "undo") => {
    const version = (layer.versions.at(-1)?.view.version ?? 0) + 1;
    layer.versions.push({
      view: { version, createdAt: now(), reason },
      layer: structuredClone(layer.current),
    });
    return version;
  };

  // ---- approvals ----

  function canDecide(user: MockUser, a: ApprovalView): boolean {
    if (a.state !== "pending") return false;
    if (a.approver === "self") return a.user.id === user.id;
    if (a.approver === "admin") return user.isAdmin;
    if (a.approver === "owner") return user.id === ownerId;
    return false;
  }
  const approvalView = (user: MockUser, a: ApprovalView): ApprovalView => {
    const decidable = canDecide(user, a);
    let decideWith: ApprovalView["decideWith"] = null;
    if (decidable) decideWith = a.approver === "owner" ? "passkey" : "tap";
    return { ...structuredClone(a), canDecide: decidable, decideWith };
  };
  const visibleApproval = (user: MockUser, id: string): ApprovalView => {
    const a = approvals.find((x) => x.id === id && (user.isAdmin || x.user.id === user.id));
    if (!a) throw new HttpError(404, "not_found", "no such approval");
    return a;
  };
  const addNotice = (userId: string, notice: Omit<NoticeView, "id" | "createdAt" | "read">) => {
    const list = noticesOf(userId);
    list.unshift({ ...notice, id: `n${Date.now()}`, createdAt: now(), read: false });
    notices.set(userId, list);
  };
  const finish = (
    user: MockUser,
    a: ApprovalView,
    d: {
      state: "approved" | "denied";
      note: string | null;
      grantScope?: "task" | "role";
      passkey?: boolean;
    },
  ) => {
    Object.assign(a, {
      state: d.state,
      updatedAt: now(),
      decision: {
        by: { id: user.id, email: user.email, name: user.name },
        at: now(),
        note: d.note,
        grantScope: d.grantScope ?? null,
        passkey: d.passkey ?? false,
      },
    });
    if (user.id !== a.user.id) {
      const verb = d.state === "denied" ? "Denied" : "Approved";
      addNotice(a.user.id, {
        kind: "approval_decided",
        text: `${verb} by ${user.name}: ${a.preview.summary}`,
        taskId: a.taskId,
      });
    }
    if (a.kind === "action" && d.state === "approved") {
      Object.assign(a, { state: "executing", updatedAt: now() });
      setTimeout(
        () => Object.assign(a, { state: "done", result: { ok: true }, updatedAt: now() }),
        startDelay,
      );
    }
  };
  const decide: Handler = async ({ user, params, body }) => {
    const a = visibleApproval(user, params[0] ?? "");
    if (a.state !== "pending")
      throw new HttpError(409, "conflict", `this request is already ${a.state}`);
    if (!canDecide(user, a)) throw new HttpError(403, "forbidden", "you can't decide this");
    const request = (await body()) as DecideRequest;
    const note = request.note?.trim() || null;
    if (request.decision === "deny") finish(user, a, { state: "denied", note });
    else if (request.decision !== "approve") {
      throw new HttpError(400, "bad_request", "decision must be approve or deny");
    } else if (a.approver === "owner") {
      throw new HttpError(400, "bad_request", "a Tier 3 change is approved with a passkey");
    } else if (a.kind === "question" && !note) {
      throw new HttpError(400, "bad_request", "an answer (note) is required");
    } else if (
      a.kind === "access" &&
      request.grantScope !== "task" &&
      request.grantScope !== "role"
    ) {
      throw new HttpError(400, "bad_request", "grantScope must be task or role");
    } else {
      finish(user, a, {
        state: "approved",
        note,
        ...(a.kind === "access" ? { grantScope: request.grantScope } : {}),
      });
    }
    return [200, approvalView(user, a)];
  };

  // ---- task handlers ----

  const createTask: Handler = async ({ user, body }) => {
    const request = (await body()) as CreateTaskRequest;
    if (!request.prompt || request.prompt.length > 16000) {
      throw new HttpError(400, "bad_request", "prompt is required");
    }
    const key = `${user.id}:${request.requestId ?? ""}`;
    const repeat = request.requestId ? tasks.find((t) => t.id === created.get(key)) : null;
    if (repeat) return [201, repeat];
    counter += 1;
    const task: TaskView = {
      id: `new${counter.toString(16).padStart(13, "0")}`,
      userId: user.id,
      title: (request.title ?? request.prompt.split("\n")[0] ?? "").slice(0, 80),
      model: request.model ?? MODELS.default,
      state: "starting",
      busy: { kind: "creating", since: now() },
      error: null,
      pausedReason: null,
      createdAt: now(),
      updatedAt: now(),
      connected: false,
      agentId: null,
    };
    tasks.unshift(task);
    if (request.requestId) created.set(key, task.id);
    if (options.newTaskDaemon) daemons[task.id] = options.newTaskDaemon;
    startLater(task);
    return [201, task];
  };
  const pauseTask: Handler = ({ user, params }) => {
    const task = ownTask(user, params[0] ?? "");
    if (!["starting", "running", "idle"].includes(task.state)) {
      throw new HttpError(409, "conflict", "the task is not running");
    }
    return [202, touch(task, { state: "paused", pausedReason: "user", connected: false })];
  };
  const resumeTask: Handler = ({ user, params }) => {
    const task = ownTask(user, params[0] ?? "");
    if (task.state !== "paused") throw new HttpError(409, "conflict", "the task is not paused");
    touch(task, {
      state: "starting",
      busy: { kind: "resuming", since: now() },
      pausedReason: null,
    });
    startLater(task);
    return [202, task];
  };

  // ---- personal layer handlers ----

  const putSkill: Handler = async (ctx) => {
    const { layer, saved } = layerFor(ctx);
    const name = decodeURIComponent(ctx.params[1] ?? "");
    const { files } = (await ctx.body()) as { files: Record<string, string> };
    if (!files?.["SKILL.md"]) throw new HttpError(400, "bad_request", "SKILL.md is required");
    layer.current.skills = [
      ...layer.current.skills.filter((s) => s.name !== name),
      { name, files },
    ];
    return [200, saved()];
  };
  const deleteSkill: Handler = (ctx) => {
    const { layer, saved } = layerFor(ctx);
    const name = decodeURIComponent(ctx.params[1] ?? "");
    if (!layer.current.skills.some((s) => s.name === name)) {
      throw new HttpError(404, "not_found", "no such skill");
    }
    layer.current.skills = layer.current.skills.filter((s) => s.name !== name);
    return [200, saved()];
  };
  const addNote: Handler = async (ctx) => {
    const { layer, saved } = layerFor(ctx);
    const { text } = (await ctx.body()) as { text: string };
    const note: PersonalNote = {
      id: `n${Date.now()}`,
      text: text.trim(),
      createdAt: now(),
      source: "user",
      taskId: null,
    };
    layer.current.notes = [...layer.current.notes, note];
    saved();
    return [201, note];
  };
  const resetLayer: Handler = (ctx) => {
    const { layer, view } = layerFor(ctx);
    const version = isEmpty(layer.current) ? null : archive(layer, "reset");
    layer.current = { ...emptyLayer(), updatedAt: now() };
    return [200, { version, layer: view() } satisfies ResetResult];
  };
  const undoLayer: Handler = (ctx) => {
    const { layer, view } = layerFor(ctx);
    const latest = layer.versions.at(-1);
    if (!latest) throw new HttpError(409, "conflict", "nothing to undo");
    const restore = structuredClone(latest.layer);
    if (!isEmpty(layer.current)) archive(layer, "undo");
    layer.current = { ...restore, updatedAt: now() };
    return [200, view()];
  };
  // "Suggest for everyone": a pretend pull request on the org-env repo (docs/API.md section 7a).
  const suggest: Handler = async (ctx) => {
    const owner = userFor(ctx.user, ctx.params[0] ?? "");
    const request = (await ctx.body()) as SuggestRequest;
    const layer = layerOf(owner.id).current;
    let name = "";
    let title = "";
    if (request.kind === "skill") {
      if (!layer.skills.some((skill) => skill.name === request.name)) {
        throw new HttpError(404, "not_found", "no such skill");
      }
      name = request.name;
      title = `Suggest skill "${name}" for everyone`;
    } else if (request.kind === "note") {
      const note = layer.notes.find((n) => n.id === request.noteId);
      if (!note) throw new HttpError(404, "not_found", "no such note");
      name = note.id;
      title = `Suggest a note for everyone: ${note.text.slice(0, 60)}`;
    } else {
      if (!layer.instructions.trim()) {
        throw new HttpError(409, "conflict", "the personal instructions are empty");
      }
      title = `Suggest ${owner.name}'s instructions for everyone`;
    }
    const open = suggestions.find(
      (s) =>
        s.userId === owner.id && s.kind === request.kind && s.name === name && s.state === "open",
    );
    if (open) throw new HttpError(409, "conflict", `already suggested and still open: ${open.url}`);
    const number = suggestions.length + 1;
    const suggestion: SuggestionView = {
      id: `sg${number}`,
      userId: owner.id,
      userEmail: owner.email,
      byUserId: ctx.user.id,
      kind: request.kind,
      name,
      title,
      number,
      url: `https://github.example/org/org-env/pull/${number}`,
      state: "open",
      createdAt: now(),
      updatedAt: now(),
      checkedAt: now(),
    };
    suggestions.unshift(suggestion);
    return [201, suggestion];
  };
  const listSuggestions: Handler = ({ user, query }) => {
    if (query.get("all") === "1") {
      requireAdmin(user);
      return [200, { suggestions }];
    }
    const owner = userFor(user, query.get("userId") ?? user.id);
    return [200, { suggestions: suggestions.filter((s) => s.userId === owner.id) }];
  };
  const archiveLink: Handler = ({ user, params, query }) => {
    const task = ownTask(user, params[0] ?? "");
    if (task.state !== "archived") {
      throw new HttpError(409, "conflict", "this task has no archived state");
    }
    if (query.get("link") !== "1")
      throw new HttpError(400, "bad_request", "the mock answers ?link=1");
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    return [200, { url: `https://bucket.example/archives/${task.id}/state.tar.gz`, expiresAt }];
  };
  const setLimits: Handler = async (ctx) => {
    requireAdmin(ctx.user);
    const target = userFor(ctx.user, ctx.params[0] ?? "");
    const request = (await ctx.body()) as SetLimitsRequest;
    const previous = limits.get(target.id) ?? { usd: null, hours: null };
    limits.set(target.id, {
      usd: setOverride(previous.usd, request.openrouterMonthlyUsd),
      hours: setOverride(previous.hours, request.machineHoursPerMonth),
      tools: setOverride(previous.tools ?? null, request.toolsMonthlyUsd),
      proxy: setOverride(previous.proxy ?? null, request.proxyMonthlyGb),
    });
    return [200, detailOf(target)];
  };

  const ID = "([^/]+)";
  const routes: Route[] = [
    ["GET", /^\/api\/me$/, ({ user }) => [200, meOf(user)]],
    ["GET", /^\/api\/models$/, () => [200, MODELS]],
    ["GET", /^\/api\/notices$/, ({ user }) => [200, { notices: noticesOf(user.id) }]],
    [
      "POST",
      /^\/api\/notices\/read$/,
      async ({ user, body }) => {
        const { upTo } = (await body()) as MarkNoticesReadRequest;
        const list = noticesOf(user.id);
        const from = upTo === undefined ? 0 : list.findIndex((notice) => notice.id === upTo);
        if (from < 0) throw new HttpError(404, "not_found", "no such notice");
        for (const notice of list.slice(from)) notice.read = true;
        return [200, { unreadNotices: meOf(user).unreadNotices }];
      },
    ],
    [
      "GET",
      /^\/api\/tasks$/,
      ({ user, query }) => {
        const owner = userFor(user, query.get("userId") ?? user.id);
        return [200, { tasks: tasks.filter((t) => t.userId === owner.id) }];
      },
    ],
    ["GET", new RegExp(`^/api/tasks/${ID}/archive$`), archiveLink],
    ["GET", /^\/api\/suggestions$/, listSuggestions],
    ["POST", new RegExp(`^/api/users/${ID}/layer/suggest$`), suggest],
    ["POST", /^\/api\/tasks$/, createTask],
    [
      "GET",
      /^\/api\/approvals$/,
      ({ user, query }) => {
        const taskId = query.get("taskId");
        const list = approvals
          .filter((a) => user.isAdmin || a.user.id === user.id)
          .filter((a) => !taskId || a.taskId === taskId)
          .filter((a) => query.get("pending") !== "1" || canDecide(user, a))
          .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((a) => approvalView(user, a));
        return [200, { approvals: list }];
      },
    ],
    [
      "GET",
      new RegExp(`^/api/approvals/${ID}$`),
      ({ user, params }) => [200, approvalView(user, visibleApproval(user, params[0] ?? ""))],
    ],
    ["POST", new RegExp(`^/api/approvals/${ID}/decide$`), decide],
    [
      "GET",
      new RegExp(`^/api/tasks/${ID}$`),
      ({ user, params }) => [200, ownTask(user, params[0] ?? "")],
    ],
    [
      "DELETE",
      new RegExp(`^/api/tasks/${ID}$`),
      ({ user, params }) => [
        202,
        touch(ownTask(user, params[0] ?? ""), { state: "archived", busy: null, connected: false }),
      ],
    ],
    ["POST", new RegExp(`^/api/tasks/${ID}/pause$`), pauseTask],
    ["POST", new RegExp(`^/api/tasks/${ID}/resume$`), resumeTask],
    [
      "GET",
      /^\/api\/users$/,
      ({ user }) => {
        requireAdmin(user);
        return [200, { users: users.map(detailOf) }];
      },
    ],
    [
      "GET",
      new RegExp(`^/api/users/${ID}$`),
      ({ user, params }) => [200, detailOf(userFor(user, params[0] ?? ""))],
    ],
    ["PATCH", new RegExp(`^/api/users/${ID}/limits$`), setLimits],
    ["GET", new RegExp(`^/api/users/${ID}/layer$`), (ctx) => [200, layerFor(ctx).view()]],
    [
      "PUT",
      new RegExp(`^/api/users/${ID}/layer/instructions$`),
      async (ctx) => {
        const { layer, saved } = layerFor(ctx);
        layer.current.instructions = ((await ctx.body()) as { text: string }).text;
        return [200, saved()];
      },
    ],
    ["PUT", new RegExp(`^/api/users/${ID}/layer/skills/${ID}$`), putSkill],
    ["DELETE", new RegExp(`^/api/users/${ID}/layer/skills/${ID}$`), deleteSkill],
    ["POST", new RegExp(`^/api/users/${ID}/layer/notes$`), addNote],
    [
      "DELETE",
      new RegExp(`^/api/users/${ID}/layer/notes/${ID}$`),
      (ctx) => {
        const { layer, saved } = layerFor(ctx);
        layer.current.notes = layer.current.notes.filter((n) => n.id !== ctx.params[1]);
        return [200, saved()];
      },
    ],
    ["POST", new RegExp(`^/api/users/${ID}/layer/reset$`), resetLayer],
    ["POST", new RegExp(`^/api/users/${ID}/layer/undo$`), undoLayer],
  ];

  // ---- HTTP ----

  // Device tokens minted by the mock's `/api/devices/pair` (clientId -> secret and user).
  const deviceTokens = new Map<string, { secret: string; userId: string }>();

  function callerOf(req: IncomingMessage): MockUser | null {
    const clientId = req.headers["cf-access-client-id"];
    if (typeof clientId === "string") {
      const device = deviceTokens.get(clientId);
      const secret = req.headers["cf-access-client-secret"];
      if (!device || device.secret !== secret) return null;
      return users.find((user) => user.id === device.userId) ?? null;
    }
    const header = req.headers["cf-access-authenticated-user-email"];
    const cookie = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    const fromCookie = cookie ? decodeURIComponent(cookie) : null;
    const email = typeof header === "string" ? header : fromCookie;
    return users.find((user) => user.email === email) ?? null;
  }

  function send(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  function readJson(req: IncomingMessage): () => Promise<unknown> {
    return async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const text = Buffer.concat(chunks).toString("utf8");
      return text ? JSON.parse(text) : {};
    };
  }

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? "GET";
    requests.push(`${method} ${url.pathname}`);
    if (url.pathname === "/api/health") return send(res, 200, { ok: true, version: "mock" });
    if (url.pathname === "/api/devices/pair") return pairDevice(req, res, url);
    const user = callerOf(req);
    if (!user) throw new HttpError(401, "unauthenticated", "no Access identity");
    if (url.pathname.startsWith("/api/pages/") || url.pathname === "/__mock/passkey-approve") {
      return passkeyPage(user, res, url);
    }
    for (const [routeMethod, pattern, handler] of routes) {
      const match = routeMethod === method ? pattern.exec(url.pathname) : null;
      if (!match) continue;
      const [status, body] = await handler({
        user,
        params: match.slice(1),
        query: url.searchParams,
        body: readJson(req),
      });
      return send(res, status, body);
    }
    throw new HttpError(404, "not_found", "not found");
  }

  function serveStatic(res: ServerResponse, url: URL): void {
    if (!options.distDir) {
      res.writeHead(404).end("no web build");
      return;
    }
    const root = path.resolve(options.distDir);
    let file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      file = path.join(root, "index.html"); // single-page app
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  }

  // The HTTP relay: the same checks as the daemon socket, the daemon password added, and only a
  // few headers back, always as a sandboxed download (like the real server).
  async function relayHttp(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const match = /^\/api\/tasks\/([^/]+)\/daemon\/http(\/.*)$/.exec(url.pathname);
    if (!match) throw new HttpError(404, "not_found", "not found");
    requests.push(`${req.method ?? "GET"} ${url.pathname}`);
    const target = upgradeTarget(req, `/api/tasks/${match[1]}/daemon`);
    if (target === 401) throw new HttpError(401, "unauthenticated", "no Access identity");
    if (target === 503) throw new HttpError(503, "unavailable", "the task isn't connected");
    if (typeof target === "number") throw new HttpError(404, "not_found", "no such task");
    const base = new URL(target.url.replace(/^ws/, "http"));
    const upstream = await fetch(`${base.origin}${match[2]}${url.search}`, {
      method: req.method,
      headers: { authorization: `Bearer ${target.password}` },
    });
    const headers: Record<string, string> = {
      "content-disposition": "attachment",
      "content-security-policy": "sandbox; default-src 'none'",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    };
    const type = upstream.headers.get("content-type");
    if (type) headers["content-type"] = type;
    res.writeHead(upstream.status, headers);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  }

  // ---- device pairing (iOS) ----
  // `GET /api/devices/pair` the way the real server answers it (docs/API.md section 3), with a
  // mock sign-in page standing in for the Cloudflare Access login: it lists the users, and a
  // pick sets the identity cookie and returns to the pairing URL.

  function pairDevice(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const state = url.searchParams.get("state") ?? "";
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(state)) throw new HttpError(400, "bad_request", "bad state");
    const user = callerOf(req);
    if (!user) {
      res.writeHead(302, {
        location: `/__mock/sign-in?return=${encodeURIComponent(url.pathname + url.search)}`,
      });
      res.end();
      return;
    }
    const id = `dev-${deviceTokens.size + 1}`;
    const clientId = `${id}.mock-access`;
    const clientSecret = `secret-${Math.random().toString(36).slice(2)}`;
    deviceTokens.set(clientId, { secret: clientSecret, userId: user.id });
    const query = new URLSearchParams({ state, id, clientId, clientSecret });
    res.writeHead(302, { location: `${appScheme}://paired?${query.toString()}` });
    res.end();
  }

  // ---- passkey pages (stand-ins for the server's WebAuthn pages) ----

  function passkeyPage(user: MockUser, res: ServerResponse, url: URL): void {
    if (user.id !== ownerId) throw new HttpError(404, "not_found", "not found");
    const back = url.searchParams.get("return") ?? "";
    const safe = back.startsWith("/") || back.startsWith(`${appScheme}://`) ? back : "";
    const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const approve = /^\/api\/pages\/approvals\/([^/]+)$/.exec(url.pathname);
    if (url.pathname === "/__mock/passkey-approve") {
      const a = visibleApproval(user, url.searchParams.get("id") ?? "");
      if (canDecide(user, a)) finish(user, a, { state: "approved", note: null, passkey: true });
      res.writeHead(302, { location: safe || "/" });
      res.end();
      return;
    }
    let content: string;
    if (approve) {
      const a = visibleApproval(user, decodeURIComponent(approve[1] ?? ""));
      const href = `/__mock/passkey-approve?${new URLSearchParams({ id: a.id, return: safe })}`;
      content = `<h1>Infrastructure change</h1><p>${escape(a.preview.summary)}</p><p><code>${escape(a.changeHash ?? "")}</code></p><p><a id="mock-passkey-approve" href="${escape(href)}" style="font-size:22px">Approve (mock passkey)</a></p>`;
    } else {
      content = `<h1>Add a passkey</h1><p><a href="${escape(safe || "/")}" style="font-size:22px">Back</a></p>`;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><meta name="viewport" content="width=device-width"><title>Mock passkey</title><body style="font-family:system-ui;padding:24px">${content}</body>`,
    );
  }

  function signInPage(res: ServerResponse, url: URL): void {
    const back = url.searchParams.get("return") ?? "/";
    const pick = url.searchParams.get("as");
    if (pick && back.startsWith("/")) {
      res.writeHead(302, {
        location: back,
        "set-cookie": `CF_Authorization=${encodeURIComponent(pick)}; Path=/; HttpOnly`,
      });
      res.end();
      return;
    }
    const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const links = users
      .map((user) => {
        const href = `/__mock/sign-in?${new URLSearchParams({ return: back, as: user.email })}`;
        return `<p><a href="${escape(href)}" style="font-size:22px">Sign in as ${escape(user.email)}</a></p>`;
      })
      .join("");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><meta name="viewport" content="width=device-width"><title>Mock sign-in</title><body style="font-family:system-ui;padding:24px"><h1>Mock sign-in</h1>${links}</body>`,
    );
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    if (url.pathname === "/__mock/sign-in") {
      signInPage(res, url);
      return;
    }
    if (/^\/api\/tasks\/[^/]+\/daemon\/http\//.test(url.pathname)) {
      relayHttp(req, res, url).catch((error: unknown) => {
        const known =
          error instanceof HttpError ? error : new HttpError(502, "upstream", String(error));
        send(res, known.status, { error: { code: known.code, message: known.message } });
      });
      return;
    }
    if (!url.pathname.startsWith("/api/") && url.pathname !== "/__mock/passkey-approve") {
      serveStatic(res, url);
      return;
    }
    api(req, res, url).catch((error: unknown) => {
      const known =
        error instanceof HttpError ? error : new HttpError(500, "internal", String(error));
      send(res, known.status, {
        error: { code: known.code, message: known.message },
      } satisfies ApiError);
    });
  });

  // ---- the daemon proxy ----
  // Authorise like the real server (owner or admin, else the 404 answer; 503 while not
  // connected), then relay frames both ways with the daemon password added.

  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (offered) => [...offered].find((p) => !p.startsWith("paseo.bearer.")) ?? false,
  });

  function relay(client: WebSocket, target: MockDaemonTarget): void {
    const upstream = new WebSocket(target.url, [`paseo.bearer.${target.password}`]);
    const queue: { data: WebSocket.RawData; binary: boolean }[] = [];
    upstream.on("open", () => {
      for (const item of queue.splice(0)) upstream.send(item.data, { binary: item.binary });
    });
    client.on("message", (data, binary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
      else queue.push({ data, binary });
    });
    upstream.on("message", (data, binary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
    });
    const closeBoth = () => {
      if (client.readyState === WebSocket.OPEN) client.close(1001);
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close();
      }
    };
    upstream.on("close", closeBoth);
    upstream.on("error", closeBoth);
    client.on("close", closeBoth);
  }

  function upgradeTarget(req: IncomingMessage, pathname: string): MockDaemonTarget | number {
    const match = /^\/api\/tasks\/([^/]+)\/daemon$/.exec(pathname);
    if (!match) return 404;
    const user = callerOf(req);
    if (!user) return 401;
    const id = decodeURIComponent(match[1] ?? "");
    const task = tasks.find((t) => t.id === id && (t.userId === user.id || user.isAdmin));
    if (!task) return 404;
    const target = daemons[task.id];
    return task.connected && target ? target : 503;
  }

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://mock");
    requests.push(`WS ${url.pathname}`);
    const target = upgradeTarget(req, url.pathname);
    if (typeof target === "number") {
      socket.end(`HTTP/1.1 ${target} ${http.STATUS_CODES[target] ?? ""}\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => relay(client, target));
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    state: { tasks, layers, requests, notices, suggestions, approvals },
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// ---- standalone ----------------------------------------------------------------------------

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const daemonUrl = arg("daemon");
  const daemon = daemonUrl ? { url: daemonUrl, password: arg("daemon-password") ?? "" } : null;
  const t = now();
  const instance = await startMockInstance({
    distDir: arg("dist"),
    port: Number(arg("port") ?? 8090),
    newTaskDaemon: daemon,
    tasks: [
      {
        id: "demo0000000001",
        userId: "u-alice",
        title: "Draft the Q3 supplier summary",
        model: MODELS.default,
        state: daemon ? "running" : "paused",
        busy: null,
        error: null,
        pausedReason: daemon ? null : "idle",
        createdAt: t,
        updatedAt: t,
        connected: Boolean(daemon),
        agentId: null,
      },
    ],
    daemons: daemon ? { demo0000000001: daemon } : {},
    approvals: exampleApprovals("demo0000000001", "Draft the Q3 supplier summary"),
  });
  console.log(
    `[mock-instance] ${instance.url} (sign in: set the cookie CF_Authorization=alice@example.org, or admin@example.org for the owner)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  void main();
}
