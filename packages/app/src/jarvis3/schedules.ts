// Scheduled tasks, wakeups and channels (docs/API.md section 15 in DE0CH/jarvis3): the schedule
// form's pure logic (repeat <-> cron, validation, the request), labels for runs and wakeups, and
// the stores the schedules screens, the task list and a task's channel share. Unit-tested in
// schedules.test.ts. No React Native here.
import type { Jarvis3Api } from "./api";
import type {
  ChannelPostView,
  ChannelView,
  CreateScheduleRequest,
  NoticeView,
  ScheduleDetail,
  SchedulePreview,
  ScheduleRunResult,
  ScheduleRunView,
  ScheduleView,
  TaskView,
  WakeupView,
} from "./api-types";
import type { Tone } from "./plan";
import { countOf } from "./count";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The device's IANA zone (the app sends it as X-Time-Zone), or null if the runtime has none. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// ---- repeat <-> cron ------------------------------------------------------------------------

export type RepeatKind = "hourly" | "daily" | "weekdays" | "weekly" | "monthly" | "custom";

export const REPEAT_OPTIONS: { value: RepeatKind; label: string }[] = [
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday (Mon–Fri)" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "hourly", label: "Every hour" },
  { value: "custom", label: "Custom (cron)" },
];

export const WEEKDAYS: { value: string; label: string }[] = [
  { value: "MON", label: "Monday" },
  { value: "TUE", label: "Tuesday" },
  { value: "WED", label: "Wednesday" },
  { value: "THU", label: "Thursday" },
  { value: "FRI", label: "Friday" },
  { value: "SAT", label: "Saturday" },
  { value: "SUN", label: "Sunday" },
];

const WEEKDAY_BY_NUMBER = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export interface Repeat {
  kind: RepeatKind;
  /** "HH:MM", 24-hour (daily, weekdays, weekly, monthly). */
  time: string;
  /** hourly: the minute past the hour. */
  minute: number;
  /** weekly: MON..SUN. */
  weekday: string;
  /** monthly: 1..28 (every month has it). */
  monthDay: number;
  /** custom: five fields. */
  cron: string;
}

export const DEFAULT_REPEAT: Repeat = {
  kind: "weekdays",
  time: "09:00",
  minute: 0,
  weekday: "MON",
  monthDay: 1,
  cron: "0 9 * * 1-5",
};

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseTime(text: string): { hour: number; minute: number } | null {
  const match = TIME_RE.exec(text.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** The cron expression a repeat stands for, or an error to show under the field. */
export function cronOfRepeat(repeat: Repeat): { cron: string } | { error: string } {
  if (repeat.kind === "custom") {
    const cron = repeat.cron.trim().replace(/\s+/g, " ");
    if (cron.split(" ").length !== 5) {
      return { error: "A cron expression has five fields: minute hour day month weekday." };
    }
    return { cron };
  }
  if (repeat.kind === "hourly") {
    if (!Number.isInteger(repeat.minute) || repeat.minute < 0 || repeat.minute > 59) {
      return { error: "The minute is 0 to 59." };
    }
    return { cron: `${repeat.minute} * * * *` };
  }
  const time = parseTime(repeat.time);
  if (!time) return { error: "Write the time as HH:MM, for example 09:00." };
  const at = `${time.minute} ${time.hour}`;
  switch (repeat.kind) {
    case "daily":
      return { cron: `${at} * * *` };
    case "weekdays":
      return { cron: `${at} * * 1-5` };
    case "weekly":
      return { cron: `${at} * * ${repeat.weekday}` };
    case "monthly":
      if (!Number.isInteger(repeat.monthDay) || repeat.monthDay < 1 || repeat.monthDay > 28) {
        return { error: "The day of the month is 1 to 28." };
      }
      return { cron: `${at} ${repeat.monthDay} * *` };
  }
}

function weekdayName(field: string): string | null {
  const upper = field.toUpperCase();
  if (/^[0-7]$/.test(upper)) return WEEKDAY_BY_NUMBER[Number(upper)] ?? null;
  return WEEKDAYS.some((day) => day.value === upper) ? upper : null;
}

const isNumber = (field: string, max: number) => /^\d{1,2}$/.test(field) && Number(field) <= max;

/** The repeat of an expression with a fixed hour and minute, else null. */
function dailyShape(base: Repeat, time: string, day: string, weekday: string): Repeat | null {
  if (day === "*" && weekday === "*") return { ...base, kind: "daily", time };
  if (day === "*" && (weekday === "1-5" || weekday.toUpperCase() === "MON-FRI")) {
    return { ...base, kind: "weekdays", time };
  }
  const named = day === "*" ? weekdayName(weekday) : null;
  if (named) return { ...base, kind: "weekly", time, weekday: named };
  if (weekday === "*" && isNumber(day, 28) && Number(day) >= 1) {
    return { ...base, kind: "monthly", time, monthDay: Number(day) };
  }
  return null;
}

/** The form's repeat for an existing schedule's cron: a simple shape, else "custom". */
export function repeatOfCron(cron: string): Repeat {
  const custom: Repeat = { ...DEFAULT_REPEAT, kind: "custom", cron };
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return custom;
  const [minute = "", hour = "", day = "", month = "", weekday = ""] = fields;
  if (!isNumber(minute, 59) || month !== "*") return custom;
  const m = Number(minute);
  if (hour === "*") {
    return day === "*" && weekday === "*" ? { ...custom, kind: "hourly", minute: m } : custom;
  }
  if (!isNumber(hour, 23)) return custom;
  return dailyShape(custom, `${pad2(Number(hour))}:${pad2(m)}`, day, weekday) ?? custom;
}

/** "Every weekday at 09:00", for lists; the raw expression for anything custom. */
export function describeRepeat(cron: string): string {
  const repeat = repeatOfCron(cron);
  switch (repeat.kind) {
    case "hourly":
      return repeat.minute === 0 ? "Every hour" : `Every hour at :${pad2(repeat.minute)}`;
    case "daily":
      return `Every day at ${repeat.time}`;
    case "weekdays":
      return `Every weekday at ${repeat.time}`;
    case "weekly": {
      const day = WEEKDAYS.find((d) => d.value === repeat.weekday)?.label ?? repeat.weekday;
      return `Every ${day} at ${repeat.time}`;
    }
    case "monthly":
      return `Every month on day ${repeat.monthDay} at ${repeat.time}`;
    case "custom":
      return `Cron: ${cron}`;
  }
}

// ---- the schedule form --------------------------------------------------------------------

export const SCHEDULE_PROMPT_MAX = 16_000;
export const SCHEDULE_TITLE_MAX = 120;

export interface ScheduleForm {
  title: string;
  prompt: string;
  model: string;
  repeat: Repeat;
  timeZone: string;
  enabled: boolean;
}

export function openScheduleForm(input: {
  schedule: ScheduleView | null;
  defaultModel: string;
  timeZone: string;
}): ScheduleForm {
  const s = input.schedule;
  if (!s) {
    return {
      title: "",
      prompt: "",
      model: input.defaultModel,
      repeat: DEFAULT_REPEAT,
      timeZone: input.timeZone,
      enabled: true,
    };
  }
  return {
    title: s.title,
    prompt: s.prompt,
    model: s.model,
    repeat: repeatOfCron(s.cron),
    timeZone: s.timeZone,
    enabled: s.enabled,
  };
}

export interface ScheduleFormCheck {
  cron: string | null;
  errors: { title?: string; prompt?: string; repeat?: string; timeZone?: string };
  request: CreateScheduleRequest | null;
}

/** What the form would send, or what is missing. The server checks the expression and zone too. */
export function checkScheduleForm(form: ScheduleForm): ScheduleFormCheck {
  const errors: ScheduleFormCheck["errors"] = {};
  const prompt = form.prompt.trim();
  const title = form.title.trim();
  if (!prompt) errors.prompt = "Write what the agent should do at each run.";
  else if (form.prompt.length > SCHEDULE_PROMPT_MAX) {
    errors.prompt = "The prompt is limited to 16,000 characters.";
  }
  if (title.length > SCHEDULE_TITLE_MAX) errors.title = "The title is limited to 120 characters.";
  const cron = cronOfRepeat(form.repeat);
  if ("error" in cron) errors.repeat = cron.error;
  const timeZone = form.timeZone.trim();
  if (!timeZone) errors.timeZone = "Choose a time zone, for example Europe/London.";
  const ok = Object.keys(errors).length === 0 && "cron" in cron;
  return {
    cron: "cron" in cron ? cron.cron : null,
    errors,
    request: ok
      ? {
          ...(title ? { title } : {}),
          prompt,
          ...(form.model ? { model: form.model } : {}),
          cron: cron.cron,
          timeZone,
          enabled: form.enabled,
        }
      : null,
  };
}

// ---- runs, schedules, wakeups: labels -----------------------------------------------------

const RUN_RESULT: Record<ScheduleRunResult, { label: string; tone: Tone }> = {
  started: { label: "Started", tone: "ok" },
  skipped_cap: { label: "Skipped: your machine hours were used up", tone: "error" },
  skipped_budget: { label: "Skipped: the organisation's budget was used up", tone: "error" },
  skipped_overlap: { label: "Skipped: the previous run was still going", tone: "muted" },
  missed: { label: "Missed: the instance was down", tone: "muted" },
  failed: { label: "Failed", tone: "error" },
};

export function runResultLabel(run: Pick<ScheduleRunView, "result">): {
  label: string;
  tone: Tone;
} {
  return RUN_RESULT[run.result];
}

export function scheduleStatus(
  schedule: Pick<ScheduleView, "enabled" | "nextRunAt">,
  formatWhen: (iso: string) => string,
): { label: string; tone: Tone } {
  if (!schedule.enabled) return { label: "Off", tone: "muted" };
  if (!schedule.nextRunAt) return { label: "Never runs again", tone: "muted" };
  return { label: `Next: ${formatWhen(schedule.nextRunAt)}`, tone: "idle" };
}

export function schedulesOrdered(schedules: readonly ScheduleView[]): ScheduleView[] {
  // on first, soonest first; then off ones by title
  return schedules.toSorted((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    if (a.nextRunAt && b.nextRunAt && a.nextRunAt !== b.nextRunAt) {
      return a.nextRunAt.localeCompare(b.nextRunAt);
    }
    if (Boolean(a.nextRunAt) !== Boolean(b.nextRunAt)) return a.nextRunAt ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

const WAKEUP_STATE: Record<WakeupView["state"], { label: string; tone: Tone }> = {
  armed: { label: "Waiting", tone: "idle" },
  fired: { label: "Delivered", tone: "ok" },
  expired: { label: "Gave up", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export function wakeupStateLabel(wakeup: Pick<WakeupView, "state">): {
  label: string;
  tone: Tone;
} {
  return WAKEUP_STATE[wakeup.state];
}

function minutesText(seconds: number): string {
  if (seconds % 3600 === 0) return seconds === 3600 ? "hour" : `${seconds / 3600} hours`;
  if (seconds % 60 === 0) return seconds === 60 ? "minute" : `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

/** When a wakeup fires, in words: "At …", "Every weekday at 09:00 (Europe/London)", "When …". */
export function describeWakeupWhen(
  wakeup: Pick<
    WakeupView,
    | "kind"
    | "at"
    | "cron"
    | "timeZone"
    | "check"
    | "intervalSeconds"
    | "expiresAt"
    | "state"
    | "firedAt"
  >,
  formatWhen: (iso: string) => string,
): string {
  if (wakeup.kind === "check" && wakeup.check) {
    const c = wakeup.check;
    const conditions = [
      c.status !== undefined ? `answers HTTP ${c.status}` : null,
      c.contains !== undefined ? `contains "${c.contains}"` : null,
      c.absent !== undefined ? `no longer contains "${c.absent}"` : null,
      c.changed ? "changes" : null,
    ].filter((part): part is string => part !== null);
    const every = wakeup.intervalSeconds
      ? `, checked every ${minutesText(wakeup.intervalSeconds)}`
      : "";
    const until =
      wakeup.state === "armed" && wakeup.expiresAt ? `, until ${formatWhen(wakeup.expiresAt)}` : "";
    return `When ${c.url} ${conditions.join(" and ") || "answers"}${every}${until}`;
  }
  if (wakeup.cron) {
    const zone = wakeup.timeZone ? ` (${wakeup.timeZone})` : "";
    const next = wakeup.state === "armed" && wakeup.at ? `; next ${formatWhen(wakeup.at)}` : "";
    return `${describeRepeat(wakeup.cron)}${zone}${next}`;
  }
  if (wakeup.state === "fired" && wakeup.firedAt) return `Fired ${formatWhen(wakeup.firedAt)}`;
  return wakeup.at ? `At ${formatWhen(wakeup.at)}` : "Once";
}

/** Armed first (soonest first), then the rest newest first: the server's order, kept stable. */
export function wakeupsOrdered(wakeups: readonly WakeupView[]): WakeupView[] {
  return wakeups.toSorted((a, b) => {
    const aArmed = a.state === "armed";
    const bArmed = b.state === "armed";
    if (aArmed !== bArmed) return aArmed ? -1 : 1;
    if (aArmed) {
      // a check's `at` is its next check, not a firing: timed ones first
      if ((a.kind === "check") !== (b.kind === "check")) return a.kind === "check" ? 1 : -1;
      return (a.at ?? "").localeCompare(b.at ?? "");
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/** The one-line summary on a task's chat: posts and the next wakeup. Null when there is neither. */
export function taskExtrasLine(input: {
  channel: Pick<ChannelView, "posts" | "unread"> | null;
  wakeups: readonly WakeupView[];
  formatWhen: (iso: string) => string;
}): string | null {
  const parts: string[] = [];
  if (input.channel && input.channel.posts > 0) {
    const posts = countOf(input.channel.posts, "post");
    parts.push(input.channel.unread > 0 ? `${posts} (${input.channel.unread} new)` : posts);
  }
  const armed = wakeupsOrdered(input.wakeups).filter((w) => w.state === "armed");
  const first = armed[0];
  if (first) {
    let when = "later";
    if (first.kind === "check") when = "when a page changes";
    else if (first.at) when = input.formatWhen(first.at);
    parts.push(armed.length > 1 ? `${armed.length} wakeups, next ${when}` : `wakes up ${when}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/**
 * A channel on the admin Users page: its posts and how many are unread. On someone else's row the
 * unread ones are "unread by them"; on the admin's own row they are just unread.
 */
export function channelRecordHint(
  channel: Pick<ChannelView, "posts" | "unread" | "userId">,
  viewerId: string | null,
): string {
  const posts = countOf(channel.posts, "post");
  if (channel.unread <= 0) return posts;
  return channel.userId === viewerId
    ? `${posts}, ${channel.unread} unread`
    : `${posts}, ${channel.unread} unread by them`;
}

// ---- "Wake this task at…" (the owner arms a timed wakeup) -------------------------------------

export const WAKE_MESSAGE_MAX = 4000;
const DAY_MS = 24 * 3600_000;

export interface WakeForm {
  /** "YYYY-MM-DD", the device's calendar. */
  date: string;
  /** "HH:MM", 24-hour, the device's zone. */
  time: string;
  /** What the agent gets; empty = the server's default line. */
  message: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dateText = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A new form: the next full hour from now (tomorrow's date when that crosses midnight). */
export function openWakeForm(now: Date): WakeForm {
  const next = new Date(now.getTime());
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return {
    date: dateText(next),
    time: `${pad(next.getHours())}:${pad(next.getMinutes())}`,
    message: "",
  };
}

/** The local time the form names, or why it can't be armed (the server checks the same). */
export function checkWakeForm(
  form: WakeForm,
  now: Date,
): { at: Date; request: { at: string; prompt?: string } } | { error: string } {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(form.date.trim());
  if (!d) return { error: "Write the date as YYYY-MM-DD, for example 2026-10-12." };
  const time = parseTime(form.time.trim());
  if (!time) return { error: "Write the time as HH:MM, for example 09:00." };
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const at = new Date(year, month - 1, day, time.hour, time.minute, 0, 0);
  if (at.getFullYear() !== year || at.getMonth() !== month - 1 || at.getDate() !== day) {
    return { error: "That date doesn't exist." };
  }
  if (at.getTime() <= now.getTime()) return { error: "That time has passed. Pick a later one." };
  if (at.getTime() - now.getTime() > 365 * DAY_MS) {
    return { error: "A wakeup can be at most a year ahead." };
  }
  const message = form.message.trim();
  if (message.length > WAKE_MESSAGE_MAX) {
    return { error: `The message is limited to ${WAKE_MESSAGE_MAX} characters.` };
  }
  return { at, request: { at: at.toISOString(), ...(message ? { prompt: message } : {}) } };
}

/** Where a notice's button goes, and its label; null when it has none. */
export function noticeTarget(
  notice: Pick<NoticeView, "kind" | "taskId" | "approvalId">,
): { href: string; label: string } | null {
  if (notice.kind === "approval_needed") {
    // Servers before jarvis3 e7654a6 don't name the approval: open the queue.
    const href = notice.approvalId
      ? `/approvals/${encodeURIComponent(notice.approvalId)}`
      : "/approvals";
    return { href, label: "Review" };
  }
  if (notice.kind === "schedule_skipped") return { href: "/scheduled", label: "Schedules" };
  if (!notice.taskId) return null;
  const id = encodeURIComponent(notice.taskId);
  if (notice.kind === "channel_post") return { href: `/channels/${id}`, label: "Read" };
  return { href: `/tasks/${id}`, label: "Open task" };
}

/** "Schedules" in the navigation. */
export const SCHEDULES_LABEL = "Schedules";

// ---- the schedules store ------------------------------------------------------------------

export interface SchedulesState {
  loaded: boolean;
  schedules: ScheduleView[];
  error: string | null;
  /** Schedules opened one by one, with their runs. */
  byId: Record<string, ScheduleDetail>;
  loadErrors: Record<string, string>;
  /** Actions in flight per schedule ("new" for the create form), and the last refusal. */
  busy: Record<string, "save" | "run" | "toggle" | "delete">;
  actionErrors: Record<string, string>;
  /** The last "Run now" outcome per schedule (shown on its page). */
  lastRunNow: Record<string, { run: ScheduleRunView; task: TaskView | null }>;
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _gone, ...rest } = record;
  return rest;
}

type SchedulesApi = Pick<
  Jarvis3Api,
  | "listSchedules"
  | "getSchedule"
  | "createSchedule"
  | "updateSchedule"
  | "deleteSchedule"
  | "runSchedule"
  | "previewSchedule"
>;

export function createSchedulesStore(api: SchedulesApi) {
  let state: SchedulesState = {
    loaded: false,
    schedules: [],
    error: null,
    byId: {},
    loadErrors: {},
    busy: {},
    actionErrors: {},
    lastRunNow: {},
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<SchedulesState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  /** Records a fresh copy of one schedule in the list and its page. */
  function put(schedule: ScheduleView): void {
    const index = state.schedules.findIndex((s) => s.id === schedule.id);
    const schedules =
      index < 0
        ? [schedule, ...state.schedules]
        : state.schedules.map((s, i) => (i === index ? schedule : s));
    const detail = state.byId[schedule.id];
    set({
      schedules,
      byId: detail ? { ...state.byId, [schedule.id]: { ...detail, ...schedule } } : state.byId,
    });
  }

  /** Runs one action on a schedule: two-phase (the screen shows it busy, then the server's answer). */
  async function act<T>(
    key: string,
    kind: SchedulesState["busy"][string],
    call: () => Promise<T>,
  ): Promise<T | null> {
    if (state.busy[key]) return null;
    set({ busy: { ...state.busy, [key]: kind }, actionErrors: without(state.actionErrors, key) });
    try {
      const result = await call();
      set({ busy: without(state.busy, key) });
      return result;
    } catch (error) {
      set({
        busy: without(state.busy, key),
        actionErrors: { ...state.actionErrors, [key]: messageOf(error) },
      });
      return null;
    }
  }

  async function load(scheduleId: string): Promise<void> {
    try {
      const detail = await api.getSchedule(scheduleId);
      set({
        byId: { ...state.byId, [scheduleId]: detail },
        loadErrors: without(state.loadErrors, scheduleId),
      });
      put(detail);
    } catch (error) {
      set({ loadErrors: { ...state.loadErrors, [scheduleId]: messageOf(error) } });
    }
  }

  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async loadList(): Promise<void> {
      try {
        const { schedules } = await api.listSchedules();
        set({ loaded: true, schedules, error: null });
      } catch (error) {
        set({ loaded: true, error: messageOf(error) });
      }
    },
    load,
    /** Creates a schedule; returns it, or null (the refusal is in actionErrors.new). */
    async create(request: CreateScheduleRequest): Promise<ScheduleView | null> {
      const created = await act("new", "save", () => api.createSchedule(request));
      if (created) put(created);
      return created;
    },
    async save(scheduleId: string, request: CreateScheduleRequest): Promise<boolean> {
      const saved = await act(scheduleId, "save", () => api.updateSchedule(scheduleId, request));
      if (!saved) return false;
      put(saved);
      void load(scheduleId);
      return true;
    },
    async setEnabled(scheduleId: string, enabled: boolean): Promise<boolean> {
      const saved = await act(scheduleId, "toggle", () =>
        api.updateSchedule(scheduleId, { enabled }),
      );
      if (saved) put(saved);
      return saved !== null;
    },
    async remove(scheduleId: string): Promise<boolean> {
      const done = await act(scheduleId, "delete", async () => {
        await api.deleteSchedule(scheduleId);
        return true;
      });
      if (!done) return false;
      set({
        schedules: state.schedules.filter((s) => s.id !== scheduleId),
        byId: without(state.byId, scheduleId),
        lastRunNow: without(state.lastRunNow, scheduleId),
      });
      return true;
    },
    /** "Run now": the server applies the caps and one-run-at-a-time; the outcome is kept. */
    async runNow(
      scheduleId: string,
    ): Promise<{ run: ScheduleRunView; task: TaskView | null } | null> {
      const result = await act(scheduleId, "run", () => api.runSchedule(scheduleId));
      if (!result) return null;
      set({ lastRunNow: { ...state.lastRunNow, [scheduleId]: result } });
      void load(scheduleId);
      return result;
    },
    preview: (cron: string, timeZone: string): Promise<SchedulePreview> =>
      api.previewSchedule({ cron, timeZone }),
    clearError(key: string) {
      if (state.actionErrors[key]) set({ actionErrors: without(state.actionErrors, key) });
    },
  };
}

export type SchedulesStore = ReturnType<typeof createSchedulesStore>;

// ---- channels and wakeups store -----------------------------------------------------------

export interface TaskExtrasState {
  /** GET /api/channels: one entry per task with posts. */
  channelsLoaded: boolean;
  channels: ChannelView[];
  /** taskId -> its posts (newest first) and wakeups. */
  posts: Record<string, { loaded: boolean; posts: ChannelPostView[]; error: string | null }>;
  wakeups: Record<string, { loaded: boolean; wakeups: WakeupView[]; error: string | null }>;
  /** Wakeups being cancelled, and the last refusal per wakeup. */
  cancelling: Record<string, true>;
  cancelErrors: Record<string, string>;
}

/** How often an open task chat refreshes its posts/wakeups line. */
export const REFRESH_TASK_EXTRAS_MS = 15_000;

type ExtrasApi = Pick<
  Jarvis3Api,
  "listChannels" | "listPosts" | "markPostsRead" | "listWakeups" | "cancelWakeup" | "armWakeup"
>;

export function createTaskExtrasStore(
  api: ExtrasApi,
  account: { setUnreadPosts: (n: number) => void; refreshMe: () => Promise<void> },
) {
  let state: TaskExtrasState = {
    channelsLoaded: false,
    channels: [],
    posts: {},
    wakeups: {},
    cancelling: {},
    cancelErrors: {},
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<TaskExtrasState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  async function loadWakeups(taskId: string): Promise<void> {
    try {
      const { wakeups } = await api.listWakeups(taskId);
      set({ wakeups: { ...state.wakeups, [taskId]: { loaded: true, wakeups, error: null } } });
    } catch (error) {
      const current = state.wakeups[taskId];
      set({
        wakeups: {
          ...state.wakeups,
          [taskId]: { loaded: true, wakeups: current?.wakeups ?? [], error: messageOf(error) },
        },
      });
    }
  }
  const markChannelRead = (taskId: string) =>
    set({
      channels: state.channels.map((c) => (c.taskId === taskId ? { ...c, unread: 0 } : c)),
    });

  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async loadChannels(): Promise<void> {
      try {
        const { channels } = await api.listChannels();
        set({ channelsLoaded: true, channels });
      } catch {
        // A hint on the task list; the channel screen shows errors.
        set({ channelsLoaded: true });
      }
    },
    /**
     * Loads a task's posts. With `markRead` (the channel screen is open) unread posts are marked
     * read on the server, which also clears their notices; an admin reading someone else's
     * channel changes nothing there.
     */
    async loadPosts(taskId: string, options: { markRead?: boolean } = {}): Promise<void> {
      try {
        const { posts } = await api.listPosts(taskId);
        set({ posts: { ...state.posts, [taskId]: { loaded: true, posts, error: null } } });
        if (options.markRead && posts.some((post) => !post.read)) {
          const { unreadPosts } = await api.markPostsRead(taskId);
          account.setUnreadPosts(unreadPosts);
          markChannelRead(taskId);
          void account.refreshMe();
        }
      } catch (error) {
        const current = state.posts[taskId];
        set({
          posts: {
            ...state.posts,
            [taskId]: { loaded: true, posts: current?.posts ?? [], error: messageOf(error) },
          },
        });
      }
    },
    loadWakeups,
    /**
     * "Wake this task at…": arms a timed wakeup for the owner and reloads the task's wakeups once
     * the server has it (no optimistic update). Returns the refusal's message, or null.
     */
    async armWakeup(
      taskId: string,
      request: { at: string; prompt?: string },
    ): Promise<string | null> {
      try {
        await api.armWakeup(taskId, request);
      } catch (error) {
        return messageOf(error);
      }
      await loadWakeups(taskId);
      return null;
    },
    /** Cancels a wakeup and waits for the server (no optimistic update). */
    async cancelWakeup(wakeup: WakeupView): Promise<boolean> {
      if (state.cancelling[wakeup.id]) return false;
      set({
        cancelling: { ...state.cancelling, [wakeup.id]: true },
        cancelErrors: without(state.cancelErrors, wakeup.id),
      });
      try {
        const next = await api.cancelWakeup(wakeup.id);
        const list = state.wakeups[wakeup.taskId];
        set({
          cancelling: without(state.cancelling, wakeup.id),
          wakeups: list
            ? {
                ...state.wakeups,
                [wakeup.taskId]: {
                  ...list,
                  wakeups: list.wakeups.map((w) => (w.id === next.id ? next : w)),
                },
              }
            : state.wakeups,
        });
        return true;
      } catch (error) {
        set({
          cancelling: without(state.cancelling, wakeup.id),
          cancelErrors: { ...state.cancelErrors, [wakeup.id]: messageOf(error) },
        });
        void loadWakeups(wakeup.taskId);
        return false;
      }
    },
    channelOf(taskId: string): ChannelView | null {
      return state.channels.find((c) => c.taskId === taskId) ?? null;
    },
  };
}

export type TaskExtrasStore = ReturnType<typeof createTaskExtrasStore>;
