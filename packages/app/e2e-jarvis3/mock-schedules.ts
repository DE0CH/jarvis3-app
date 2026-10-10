// The mock instance's scheduled tasks, wakeups and channels (docs/API.md section 15 in
// DE0CH/jarvis3): schedules with a small cron evaluator (numbers, ranges, lists, steps, names; one
// zone via Intl), Run now that starts a task through the mock's own task creation, wakeups listed
// and cancelled per task, and channel posts with read marks. Owner-or-admin like the server.
// Never deploy this.
import type {
  ChannelPostView,
  ChannelView,
  CreateScheduleRequest,
  ErrorCode,
  ScheduleDetail,
  SchedulePreview,
  ScheduleRunView,
  ScheduleView,
  TaskView,
  WakeupView,
} from "../src/jarvis3/api-types";

interface Caller {
  id: string;
  isAdmin: boolean;
}

interface Ctx {
  user: Caller;
  params: string[];
  query: URLSearchParams;
  body: () => Promise<unknown>;
}
type Handler = (ctx: Ctx) => [number, unknown] | Promise<[number, unknown]>;
type Route = [method: string, pattern: RegExp, handler: Handler];

export interface MockSchedulesDeps {
  fail: (status: number, code: ErrorCode, message: string) => Error;
  tasks: TaskView[];
  /** Starts a task for the caller the way POST /api/tasks does. */
  startTask: (user: Caller, request: { prompt: string; title: string; model?: string }) => TaskView;
  /** The caller's own task (or any, for an admin); throws 404 otherwise. */
  ownTask: (user: Caller, id: string) => TaskView;
  addNotice: (userId: string, kind: "channel_post", text: string, taskId: string) => void;
  defaultModel: string;
  schedules?: ScheduleDetail[];
  wakeups?: WakeupView[];
  posts?: ChannelPostView[];
}

const now = () => new Date().toISOString();

// ---- a small cron evaluator ---------------------------------------------------------------

const NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

function parseField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.toUpperCase().split(",")) {
    const [range = "", stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;
    const value = (text: string) => NAMES[text] ?? Number(text);
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const [a = "", b] = range.split("-");
      lo = value(a);
      if (b !== undefined) hi = value(b);
      else hi = stepText === undefined ? lo : max;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      return null;
    }
    for (let v = lo; v <= hi; v += step) out.add(v === 7 && max === 7 ? 0 : v);
  }
  return out;
}

interface Cron {
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  weekday: Set<number>;
  dayAny: boolean;
  weekdayAny: boolean;
}

function parseCron(expression: string): Cron | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [mi = "", h = "", d = "", mo = "", w = ""] = fields;
  const minute = parseField(mi, 0, 59);
  const hour = parseField(h, 0, 23);
  const day = parseField(d, 1, 31);
  const month = parseField(mo, 1, 12);
  const weekday = parseField(w, 0, 7);
  if (!minute || !hour || !day || !month || !weekday) return null;
  return { minute, hour, day, month, weekday, dayAny: d === "*", weekdayAny: w === "*" };
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function wallClock(t: number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    minute: Number(get("minute")),
    hour: Number(get("hour")),
    day: Number(get("day")),
    month: Number(get("month")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

function matches(cron: Cron, t: number, zone: string): boolean {
  const w = wallClock(t, zone);
  if (!cron.minute.has(w.minute) || !cron.hour.has(w.hour) || !cron.month.has(w.month)) {
    return false;
  }
  const dayOk = cron.day.has(w.day);
  const weekdayOk = cron.weekday.has(w.weekday);
  if (cron.dayAny || cron.weekdayAny) return dayOk && weekdayOk;
  return dayOk || weekdayOk;
}

/** The next `count` firings after `from` (minute steps, up to about 400 days). */
export function nextRuns(cron: Cron, zone: string, from: number, count: number): number[] {
  const out: number[] = [];
  let t = Math.floor(from / 60_000) * 60_000 + 60_000;
  const end = from + 400 * 86_400_000;
  while (out.length < count && t < end) {
    if (matches(cron, t, zone)) out.push(t);
    t += 60_000;
  }
  return out;
}

function validZone(zone: string): boolean {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
}

const localText = (t: number, zone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(t))
    .replace(",", "");

// ---- routes -------------------------------------------------------------------------------

export function createMockSchedules(deps: MockSchedulesDeps) {
  const schedules: ScheduleDetail[] = (deps.schedules ?? []).map((s) => structuredClone(s));
  const wakeups: WakeupView[] = (deps.wakeups ?? []).map((w) => structuredClone(w));
  const posts: ChannelPostView[] = (deps.posts ?? []).map((p) => structuredClone(p));
  let counter = 0;

  function timing(cronText: unknown, zone: unknown): { cron: Cron; next: number[] } {
    if (typeof zone !== "string" || !validZone(zone)) {
      throw deps.fail(400, "bad_request", "timeZone must be an IANA zone, e.g. Europe/London");
    }
    const cron = typeof cronText === "string" ? parseCron(cronText) : null;
    if (!cron) throw deps.fail(400, "bad_request", "cron must be five fields");
    const next = nextRuns(cron, zone, Date.now(), 5);
    if (next.length === 0) throw deps.fail(400, "bad_request", "this schedule never fires");
    const [first, second] = next;
    if (first !== undefined && second !== undefined && second - first < 60 * 60_000) {
      throw deps.fail(
        400,
        "bad_request",
        "a schedule may fire at most every 60 minutes (schedules.minIntervalMinutes)",
      );
    }
    return { cron, next };
  }

  const view = (s: ScheduleDetail): ScheduleView => {
    const { runs, ...rest } = s;
    return { ...rest, lastRun: runs[0] ?? null };
  };
  const visible = (user: Caller, id: string): ScheduleDetail => {
    const s = schedules.find((x) => x.id === id && (x.userId === user.id || user.isAdmin));
    if (!s) throw deps.fail(404, "not_found", "no such schedule");
    return s;
  };
  const plan = (s: ScheduleDetail) => {
    s.nextRunAt = s.enabled
      ? new Date(timing(s.cron, s.timeZone).next[0] ?? Date.now()).toISOString()
      : null;
  };

  const create: Handler = async ({ user, body }) => {
    const r = (await body()) as CreateScheduleRequest;
    if (typeof r.prompt !== "string" || !r.prompt.trim()) {
      throw deps.fail(400, "bad_request", "prompt must be 1..16000 characters");
    }
    timing(r.cron, r.timeZone);
    counter += 1;
    const s: ScheduleDetail = {
      id: `sch${counter.toString(16).padStart(6, "0")}`,
      userId: user.id,
      title: r.title?.trim() || r.prompt.trim().split("\n")[0]?.slice(0, 80) || "Schedule",
      prompt: r.prompt,
      model: r.model ?? deps.defaultModel,
      cron: r.cron.trim(),
      timeZone: r.timeZone,
      enabled: r.enabled ?? true,
      nextRunAt: null,
      lastRun: null,
      createdAt: now(),
      updatedAt: now(),
      runs: [],
    };
    plan(s);
    schedules.unshift(s);
    return [201, view(s)];
  };

  const update: Handler = async ({ user, params, body }) => {
    const s = visible(user, params[0] ?? "");
    const r = (await body()) as Partial<CreateScheduleRequest>;
    if (r.cron !== undefined || r.timeZone !== undefined) {
      timing(r.cron ?? s.cron, r.timeZone ?? s.timeZone);
    }
    Object.assign(s, {
      ...(r.title !== undefined ? { title: r.title.trim() || s.title } : {}),
      ...(r.prompt !== undefined ? { prompt: r.prompt } : {}),
      ...(r.model !== undefined ? { model: r.model } : {}),
      ...(r.cron !== undefined ? { cron: r.cron.trim() } : {}),
      ...(r.timeZone !== undefined ? { timeZone: r.timeZone } : {}),
      ...(r.enabled !== undefined ? { enabled: r.enabled } : {}),
      updatedAt: now(),
    });
    plan(s);
    return [200, view(s)];
  };

  const runNow: Handler = ({ user, params }) => {
    const s = visible(user, params[0] ?? "");
    const live = deps.tasks.some(
      (t) => t.scheduleId === s.id && ["starting", "running", "idle", "pausing"].includes(t.state),
    );
    const run: ScheduleRunView = {
      id: Date.now(),
      scheduleId: s.id,
      dueAt: now(),
      ranAt: now(),
      manual: true,
      result: live ? "skipped_overlap" : "started",
      taskId: null,
      error: null,
    };
    let task: TaskView | null = null;
    if (!live) {
      task = deps.startTask(user, {
        prompt: `[Scheduled task "${s.title}", started by hand from its schedule]\n\n${s.prompt}`,
        title: `${s.title} · now`,
        model: s.model,
      });
      task.scheduleId = s.id;
      run.taskId = task.id;
    }
    s.runs.unshift(run);
    return [task ? 201 : 200, { run, task }];
  };

  const channelsOf = (userId: string | null): ChannelView[] => {
    const byTask = new Map<string, ChannelPostView[]>();
    for (const p of posts) {
      if (userId && p.userId !== userId) continue;
      byTask.set(p.taskId, [...(byTask.get(p.taskId) ?? []), p]);
    }
    const out: ChannelView[] = [];
    for (const [taskId, list] of byTask) {
      const sorted = list.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
      const task = deps.tasks.find((t) => t.id === taskId);
      const last = sorted[0];
      if (!last) continue;
      out.push({
        taskId,
        userId: last.userId,
        taskTitle: task?.title ?? taskId,
        taskState: task?.state ?? "archived",
        scheduleId: task?.scheduleId ?? null,
        posts: sorted.length,
        unread: sorted.filter((p) => !p.read).length,
        lastPost: last,
      });
    }
    return out.toSorted((a, b) => b.lastPost.createdAt.localeCompare(a.lastPost.createdAt));
  };

  const ID = "([^/]+)";
  const routes: Route[] = [
    [
      "GET",
      /^\/api\/schedules$/,
      ({ user }) => [200, { schedules: schedules.filter((s) => s.userId === user.id).map(view) }],
    ],
    ["POST", /^\/api\/schedules$/, create],
    [
      "POST",
      /^\/api\/schedules\/preview$/,
      async ({ body }) => {
        const r = (await body()) as { cron?: unknown; timeZone?: unknown };
        try {
          const { next } = timing(r.cron, r.timeZone);
          const zone = String(r.timeZone);
          const preview: SchedulePreview = {
            ok: true,
            error: null,
            next: next.map((t) => ({ at: new Date(t).toISOString(), local: localText(t, zone) })),
          };
          return [200, preview];
        } catch (error) {
          return [200, { ok: false, error: (error as Error).message, next: [] }];
        }
      },
    ],
    [
      "GET",
      new RegExp(`^/api/schedules/${ID}$`),
      ({ user, params }) => [200, visible(user, params[0] ?? "")],
    ],
    ["PATCH", new RegExp(`^/api/schedules/${ID}$`), update],
    [
      "DELETE",
      new RegExp(`^/api/schedules/${ID}$`),
      ({ user, params }) => {
        const s = visible(user, params[0] ?? "");
        schedules.splice(schedules.indexOf(s), 1);
        return [200, { ok: true }];
      },
    ],
    ["POST", new RegExp(`^/api/schedules/${ID}/run$`), runNow],
    [
      "GET",
      /^\/api\/wakeups$/,
      ({ user, query }) => {
        const taskId = query.get("taskId");
        if (taskId) deps.ownTask(user, taskId);
        const list = wakeups.filter((w) => (taskId ? w.taskId === taskId : w.userId === user.id));
        return [200, { wakeups: list }];
      },
    ],
    [
      "DELETE",
      new RegExp(`^/api/wakeups/${ID}$`),
      ({ user, params }) => {
        const w = wakeups.find((x) => x.id === params[0] && (x.userId === user.id || user.isAdmin));
        if (!w) throw deps.fail(404, "not_found", "no such wakeup");
        if (w.state !== "armed") throw deps.fail(409, "conflict", `this wakeup is ${w.state}`);
        Object.assign(w, { state: "cancelled", at: null });
        return [200, w];
      },
    ],
    [
      "GET",
      /^\/api\/channels$/,
      ({ user, query }) => {
        if (query.get("all") === "1") {
          if (!user.isAdmin) throw deps.fail(404, "not_found", "not found");
          return [200, { channels: channelsOf(null) }];
        }
        const forUser = query.get("userId") ?? user.id;
        if (forUser !== user.id && !user.isAdmin) throw deps.fail(404, "not_found", "not found");
        return [200, { channels: channelsOf(forUser) }];
      },
    ],
    [
      "GET",
      new RegExp(`^/api/tasks/${ID}/posts$`),
      ({ user, params }) => {
        const task = deps.ownTask(user, params[0] ?? "");
        const list = posts
          .filter((p) => p.taskId === task.id)
          .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
        return [200, { posts: list }];
      },
    ],
    [
      "POST",
      new RegExp(`^/api/tasks/${ID}/posts/read$`),
      ({ user, params }) => {
        const task = deps.ownTask(user, params[0] ?? "");
        if (task.userId === user.id) {
          for (const p of posts) if (p.taskId === task.id) p.read = true;
        }
        return [200, { unreadPosts: unreadPosts(user.id) }];
      },
    ],
  ];

  function unreadPosts(userId: string): number {
    return posts.filter((p) => p.userId === userId && !p.read).length;
  }

  /** A post from a task's agent (what the session's jarvis_post does), with its notice. */
  function addPost(taskId: string, title: string, text: string): ChannelPostView {
    const task = deps.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`no task ${taskId}`);
    const post: ChannelPostView = {
      id: `p${Date.now()}${posts.length}`,
      taskId,
      userId: task.userId,
      title,
      text,
      createdAt: now(),
      read: false,
    };
    posts.push(post);
    deps.addNotice(task.userId, "channel_post", `${task.title}: ${title}`, taskId);
    return post;
  }

  return { routes, state: { schedules, wakeups, posts }, unreadPosts, addPost };
}
