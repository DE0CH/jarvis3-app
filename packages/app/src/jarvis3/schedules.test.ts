import { describe, expect, it } from "vitest";
import { createJarvis3Api } from "./api";
import type {
  ChannelPostView,
  ChannelView,
  ScheduleDetail,
  ScheduleRunView,
  ScheduleView,
  WakeupView,
} from "./api-types";
import { Jarvis3Error } from "./plan";
import {
  channelRecordHint,
  checkScheduleForm,
  checkWakeForm,
  createSchedulesStore,
  createTaskExtrasStore,
  cronOfRepeat,
  DEFAULT_REPEAT,
  describeRepeat,
  describeWakeupWhen,
  noticeTarget,
  openScheduleForm,
  openWakeForm,
  repeatOfCron,
  runResultLabel,
  scheduleStatus,
  schedulesOrdered,
  taskExtrasLine,
  wakeupsOrdered,
} from "./schedules";

const when = (iso: string) => `<${iso}>`;

function schedule(patch: Partial<ScheduleView> = {}): ScheduleView {
  return {
    id: "s1",
    userId: "u1",
    title: "Weekly digest",
    prompt: "Summarise the week",
    model: "m1",
    cron: "0 9 * * MON",
    timeZone: "Europe/London",
    enabled: true,
    nextRunAt: "2026-10-12T08:00:00.000Z",
    lastRun: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...patch,
  };
}

function run(patch: Partial<ScheduleRunView> = {}): ScheduleRunView {
  return {
    id: 1,
    scheduleId: "s1",
    dueAt: "2026-10-12T08:00:00.000Z",
    ranAt: "2026-10-12T08:00:01.000Z",
    manual: false,
    result: "started",
    taskId: "t1",
    error: null,
    ...patch,
  };
}

function wakeup(patch: Partial<WakeupView> = {}): WakeupView {
  return {
    id: "w1",
    taskId: "t1",
    userId: "u1",
    name: "default",
    kind: "time",
    prompt: "Look again",
    failPrompt: null,
    at: "2026-10-12T09:00:00.000Z",
    cron: null,
    timeZone: null,
    check: null,
    intervalSeconds: null,
    expiresAt: null,
    state: "armed",
    firedAt: null,
    lastError: null,
    checks: 0,
    createdAt: "2026-10-10T09:00:00.000Z",
    ...patch,
  };
}

function post(patch: Partial<ChannelPostView> = {}): ChannelPostView {
  return {
    id: "p1",
    taskId: "t1",
    userId: "u1",
    title: "Report",
    text: "All good",
    createdAt: "2026-10-10T10:00:00.000Z",
    read: false,
    ...patch,
  };
}

function channel(patch: Partial<ChannelView> = {}): ChannelView {
  return {
    taskId: "t1",
    userId: "u1",
    taskTitle: "Task",
    taskState: "idle",
    scheduleId: null,
    posts: 2,
    unread: 1,
    lastPost: post(),
    ...patch,
  };
}

describe("repeat <-> cron", () => {
  it("builds the cron of each simple repeat", () => {
    const base = { ...DEFAULT_REPEAT, time: "08:30" };
    expect(cronOfRepeat({ ...base, kind: "daily" })).toEqual({ cron: "30 8 * * *" });
    expect(cronOfRepeat({ ...base, kind: "weekdays" })).toEqual({ cron: "30 8 * * 1-5" });
    expect(cronOfRepeat({ ...base, kind: "weekly", weekday: "FRI" })).toEqual({
      cron: "30 8 * * FRI",
    });
    expect(cronOfRepeat({ ...base, kind: "monthly", monthDay: 15 })).toEqual({
      cron: "30 8 15 * *",
    });
    expect(cronOfRepeat({ ...base, kind: "hourly", minute: 5 })).toEqual({ cron: "5 * * * *" });
    expect(cronOfRepeat({ ...base, kind: "custom", cron: "  0  7 * * SAT " })).toEqual({
      cron: "0 7 * * SAT",
    });
  });

  it("says what is wrong instead of building a bad expression", () => {
    expect(cronOfRepeat({ ...DEFAULT_REPEAT, kind: "daily", time: "25:00" })).toHaveProperty(
      "error",
    );
    expect(cronOfRepeat({ ...DEFAULT_REPEAT, kind: "daily", time: "9" })).toHaveProperty("error");
    expect(cronOfRepeat({ ...DEFAULT_REPEAT, kind: "monthly", monthDay: 31 })).toHaveProperty(
      "error",
    );
    expect(cronOfRepeat({ ...DEFAULT_REPEAT, kind: "hourly", minute: Number.NaN })).toHaveProperty(
      "error",
    );
    expect(cronOfRepeat({ ...DEFAULT_REPEAT, kind: "custom", cron: "0 9 * *" })).toHaveProperty(
      "error",
    );
  });

  it("reads a schedule's cron back into the form's repeat", () => {
    expect(repeatOfCron("0 9 * * *")).toMatchObject({ kind: "daily", time: "09:00" });
    expect(repeatOfCron("30 8 * * 1-5")).toMatchObject({ kind: "weekdays", time: "08:30" });
    expect(repeatOfCron("0 9 * * MON")).toMatchObject({ kind: "weekly", weekday: "MON" });
    expect(repeatOfCron("0 9 * * 0")).toMatchObject({ kind: "weekly", weekday: "SUN" });
    expect(repeatOfCron("0 9 1 * *")).toMatchObject({ kind: "monthly", monthDay: 1 });
    expect(repeatOfCron("15 * * * *")).toMatchObject({ kind: "hourly", minute: 15 });
    for (const cron of ["*/15 * * * *", "0 9 31 * *", "0 9 1 1 *", "0 9,17 * * *", "0 9 1 * MON"]) {
      expect(repeatOfCron(cron)).toMatchObject({ kind: "custom", cron });
    }
  });

  it("round-trips every simple repeat", () => {
    for (const cron of ["0 9 * * *", "30 8 * * 1-5", "0 18 * * FRI", "0 7 28 * *", "45 * * * *"]) {
      expect(cronOfRepeat(repeatOfCron(cron))).toEqual({ cron });
    }
  });

  it("describes a schedule's repeat in words", () => {
    expect(describeRepeat("0 9 * * 1-5")).toBe("Every weekday at 09:00");
    expect(describeRepeat("0 9 * * MON")).toBe("Every Monday at 09:00");
    expect(describeRepeat("0 * * * *")).toBe("Every hour");
    expect(describeRepeat("0 9 3 * *")).toBe("Every month on day 3 at 09:00");
    expect(describeRepeat("*/30 9-17 * * *")).toBe("Cron: */30 9-17 * * *");
  });
});

describe("the schedule form", () => {
  it("opens empty for a new schedule, in the device's zone and the default model", () => {
    const form = openScheduleForm({ schedule: null, defaultModel: "m1", timeZone: "Asia/Tokyo" });
    expect(form).toMatchObject({ title: "", prompt: "", model: "m1", timeZone: "Asia/Tokyo" });
    expect(form.enabled).toBe(true);
  });

  it("opens an existing schedule with its own zone, not the device's", () => {
    const form = openScheduleForm({
      schedule: schedule({ enabled: false }),
      defaultModel: "m2",
      timeZone: "Asia/Tokyo",
    });
    expect(form).toMatchObject({
      title: "Weekly digest",
      model: "m1",
      timeZone: "Europe/London",
      enabled: false,
    });
    expect(form.repeat).toMatchObject({ kind: "weekly", weekday: "MON", time: "09:00" });
  });

  it("builds the request, or lists what is missing", () => {
    const form = openScheduleForm({ schedule: null, defaultModel: "m1", timeZone: "UTC" });
    const empty = checkScheduleForm(form);
    expect(empty.request).toBeNull();
    expect(empty.errors.prompt).toBeTruthy();
    const ready = checkScheduleForm({ ...form, prompt: "  Report  ", title: " " });
    expect(ready.request).toEqual({
      prompt: "Report",
      model: "m1",
      cron: "0 9 * * 1-5",
      timeZone: "UTC",
      enabled: true,
    });
    const bad = checkScheduleForm({
      ...form,
      prompt: "x",
      timeZone: "",
      repeat: { ...form.repeat, time: "nine" },
    });
    expect(bad.request).toBeNull();
    expect(bad.errors.timeZone).toBeTruthy();
    expect(bad.errors.repeat).toBeTruthy();
    expect(checkScheduleForm({ ...form, prompt: "x".repeat(16_001) }).errors.prompt).toMatch(
      /16,000/,
    );
  });
});

describe("labels", () => {
  it("names each run result", () => {
    expect(runResultLabel(run()).tone).toBe("ok");
    expect(runResultLabel(run({ result: "skipped_cap" })).label).toMatch(/machine hours/);
    expect(runResultLabel(run({ result: "skipped_overlap" })).label).toMatch(/previous run/);
  });

  it("says when a schedule runs next, or why it doesn't", () => {
    expect(scheduleStatus(schedule(), when).label).toBe("Next: <2026-10-12T08:00:00.000Z>");
    expect(scheduleStatus(schedule({ enabled: false }), when).label).toBe("Off");
    expect(scheduleStatus(schedule({ nextRunAt: null }), when).label).toBe("Never runs again");
  });

  it("orders schedules: on and soonest first, then off", () => {
    const list = [
      schedule({ id: "off", enabled: false, title: "A" }),
      schedule({ id: "late", nextRunAt: "2026-10-20T00:00:00.000Z" }),
      schedule({ id: "soon", nextRunAt: "2026-10-11T00:00:00.000Z" }),
    ];
    expect(schedulesOrdered(list).map((s) => s.id)).toEqual(["soon", "late", "off"]);
  });

  it("describes when a wakeup fires", () => {
    expect(describeWakeupWhen(wakeup(), when)).toBe("At <2026-10-12T09:00:00.000Z>");
    expect(
      describeWakeupWhen(
        wakeup({ state: "fired", at: null, firedAt: "2026-10-12T09:00:01.000Z" }),
        when,
      ),
    ).toBe("Fired <2026-10-12T09:00:01.000Z>");
    expect(
      describeWakeupWhen(wakeup({ cron: "0 9 * * 1-5", timeZone: "Europe/London" }), when),
    ).toBe("Every weekday at 09:00 (Europe/London); next <2026-10-12T09:00:00.000Z>");
    expect(
      describeWakeupWhen(
        wakeup({
          kind: "check",
          check: { url: "https://example.org/status", contains: "done", status: 200 },
          intervalSeconds: 300,
          expiresAt: "2026-10-17T09:00:00.000Z",
        }),
        when,
      ),
    ).toBe(
      'When https://example.org/status answers HTTP 200 and contains "done", checked every 5 minutes, until <2026-10-17T09:00:00.000Z>',
    );
  });

  it("puts armed wakeups first, soonest first", () => {
    const list = [
      wakeup({ id: "fired", state: "fired", createdAt: "2026-10-09T00:00:00.000Z" }),
      wakeup({ id: "later", at: "2026-10-13T00:00:00.000Z" }),
      wakeup({ id: "sooner", at: "2026-10-11T00:00:00.000Z" }),
    ];
    expect(wakeupsOrdered(list).map((w) => w.id)).toEqual(["sooner", "later", "fired"]);
  });

  it("sums up a task's posts and next wakeup in one line", () => {
    expect(taskExtrasLine({ channel: null, wakeups: [], formatWhen: when })).toBeNull();
    expect(taskExtrasLine({ channel: channel(), wakeups: [wakeup()], formatWhen: when })).toBe(
      "2 posts (1 new) · wakes up <2026-10-12T09:00:00.000Z>",
    );
    expect(
      taskExtrasLine({
        channel: channel({ posts: 1, unread: 0 }),
        wakeups: [wakeup({ state: "fired" })],
        formatWhen: when,
      }),
    ).toBe("1 post");
    expect(
      taskExtrasLine({
        channel: null,
        wakeups: [wakeup(), wakeup({ id: "w2", kind: "check", at: null })],
        formatWhen: when,
      }),
    ).toBe("2 wakeups, next <2026-10-12T09:00:00.000Z>");
  });

  it("sends each notice to its page", () => {
    expect(noticeTarget({ kind: "channel_post", taskId: "t 1" })).toEqual({
      href: "/channels/t%201",
      label: "Read",
    });
    expect(noticeTarget({ kind: "schedule_skipped", taskId: null })?.href).toBe("/scheduled");
    expect(noticeTarget({ kind: "wakeup", taskId: "t1" })?.href).toBe("/chats/t1");
    expect(noticeTarget({ kind: "approval_needed", taskId: "t1" })?.href).toBe("/approvals");
    expect(noticeTarget({ kind: "approval_needed", taskId: "t1", approvalId: null })?.href).toBe(
      "/approvals",
    );
    expect(noticeTarget({ kind: "approval_needed", taskId: "t1", approvalId: "ap 1" })).toEqual({
      href: "/approvals/ap%201",
      label: "Review",
    });
    // a decided approval's notice still opens its task
    expect(noticeTarget({ kind: "approval_decided", taskId: "t1", approvalId: "ap1" })?.href).toBe(
      "/chats/t1",
    );
    expect(noticeTarget({ kind: "instance_budget", taskId: null })).toBeNull();
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

function schedulesApi(overrides: Partial<Parameters<typeof createSchedulesStore>[0]> = {}) {
  const detail: ScheduleDetail = { ...schedule(), runs: [run()] };
  return {
    listSchedules: async () => ({ schedules: [schedule()] }),
    getSchedule: async () => detail,
    createSchedule: async () => schedule({ id: "s2", title: "New" }),
    updateSchedule: async () => schedule({ enabled: false, nextRunAt: null }),
    deleteSchedule: async () => ({ ok: true }),
    runSchedule: async () => ({ run: run({ manual: true }), task: null }),
    previewSchedule: async () => ({ ok: true, error: null, next: [] }),
    ...overrides,
  };
}

describe("the schedules store", () => {
  it("loads the list and one schedule with its runs", async () => {
    const store = createSchedulesStore(schedulesApi());
    await store.loadList();
    expect(store.get().schedules.map((s) => s.id)).toEqual(["s1"]);
    await store.load("s1");
    expect(store.get().byId.s1?.runs).toHaveLength(1);
  });

  it("is two-phase: busy while the server works, then its answer", async () => {
    const gate = deferred<ScheduleView>();
    const store = createSchedulesStore(schedulesApi({ updateSchedule: () => gate.promise }));
    await store.loadList();
    const toggling = store.setEnabled("s1", false);
    expect(store.get().busy.s1).toBe("toggle");
    expect(store.get().schedules[0]?.enabled).toBe(true);
    expect(await store.setEnabled("s1", false)).toBe(false); // one action at a time
    gate.resolve(schedule({ enabled: false, nextRunAt: null }));
    expect(await toggling).toBe(true);
    expect(store.get().busy.s1).toBeUndefined();
    expect(store.get().schedules[0]?.enabled).toBe(false);
  });

  it("keeps a refusal for the page to show", async () => {
    const store = createSchedulesStore(
      schedulesApi({
        createSchedule: async () => {
          throw new Jarvis3Error("cron fires more often than every 60 minutes", 400, "bad_request");
        },
      }),
    );
    expect(await store.create({ prompt: "x", cron: "* * * * *", timeZone: "UTC" })).toBeNull();
    expect(store.get().actionErrors.new).toMatch(/60 minutes/);
    store.clearError("new");
    expect(store.get().actionErrors.new).toBeUndefined();
  });

  it("adds a created schedule and drops a deleted one", async () => {
    const store = createSchedulesStore(schedulesApi());
    await store.loadList();
    expect((await store.create({ prompt: "x", cron: "0 9 * * *", timeZone: "UTC" }))?.id).toBe(
      "s2",
    );
    expect(store.get().schedules.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(await store.remove("s1")).toBe(true);
    expect(store.get().schedules.map((s) => s.id)).toEqual(["s2"]);
  });

  it("keeps Run now's outcome (a skipped run is not an error)", async () => {
    const store = createSchedulesStore(
      schedulesApi({
        runSchedule: async () => ({
          run: run({ result: "skipped_overlap", taskId: null }),
          task: null,
        }),
      }),
    );
    const result = await store.runNow("s1");
    expect(result?.run.result).toBe("skipped_overlap");
    expect(store.get().lastRunNow.s1?.run.result).toBe("skipped_overlap");
    expect(store.get().actionErrors.s1).toBeUndefined();
  });
});

describe("the channels and wakeups store", () => {
  function setup(overrides: Partial<Parameters<typeof createTaskExtrasStore>[0]> = {}) {
    const unread: number[] = [];
    let refreshed = 0;
    const api = {
      listChannels: async () => ({ channels: [channel()] }),
      listPosts: async () => ({ posts: [post(), post({ id: "p0", read: true })] }),
      markPostsRead: async () => ({ unreadPosts: 0 }),
      listWakeups: async () => ({ wakeups: [wakeup()] }),
      cancelWakeup: async () => wakeup({ state: "cancelled" }),
      armWakeup: async () => wakeup({ setBy: "owner", name: "app-1a2b3c" }),
      ...overrides,
    };
    const store = createTaskExtrasStore(api, {
      setUnreadPosts: (n) => unread.push(n),
      refreshMe: async () => {
        refreshed += 1;
      },
    });
    return { store, unread, refreshed: () => refreshed };
  }

  it("opening a channel marks its posts read and clears the count", async () => {
    const { store, unread } = setup();
    await store.loadChannels();
    await store.loadPosts("t1", { markRead: true });
    expect(store.get().posts.t1?.posts).toHaveLength(2);
    expect(unread).toEqual([0]);
    expect(store.channelOf("t1")?.unread).toBe(0);
  });

  it("doesn't mark read when nothing is unread, or when only peeking", async () => {
    let marked = 0;
    const { store } = setup({
      markPostsRead: async () => {
        marked += 1;
        return { unreadPosts: 0 };
      },
    });
    await store.loadPosts("t1");
    expect(marked).toBe(0);
    const allRead = setup({
      listPosts: async () => ({ posts: [post({ read: true })] }),
      markPostsRead: async () => {
        marked += 1;
        return { unreadPosts: 0 };
      },
    });
    await allRead.store.loadPosts("t1", { markRead: true });
    expect(marked).toBe(0);
  });

  it("cancels a wakeup through the server and shows its new state", async () => {
    const gate = deferred<WakeupView>();
    const { store } = setup({ cancelWakeup: () => gate.promise });
    await store.loadWakeups("t1");
    const target = store.get().wakeups.t1?.wakeups[0];
    if (!target) throw new Error("no wakeup");
    const cancelling = store.cancelWakeup(target);
    expect(store.get().cancelling.w1).toBe(true);
    expect(store.get().wakeups.t1?.wakeups[0]?.state).toBe("armed");
    gate.resolve(wakeup({ state: "cancelled" }));
    expect(await cancelling).toBe(true);
    expect(store.get().wakeups.t1?.wakeups[0]?.state).toBe("cancelled");
  });

  it("keeps a refused cancel's message and reloads the list", async () => {
    let loads = 0;
    const { store } = setup({
      listWakeups: async () => {
        loads += 1;
        return { wakeups: [wakeup({ state: "fired" })] };
      },
      cancelWakeup: async () => {
        throw new Jarvis3Error("this wakeup is not armed", 409, "conflict");
      },
    });
    expect(await store.cancelWakeup(wakeup())).toBe(false);
    expect(store.get().cancelErrors.w1).toMatch(/not armed/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loads).toBe(1);
  });
});

describe("the API client", () => {
  it("sends the device's zone and calls the schedule, wakeup and channel routes", async () => {
    const calls: [string, RequestInit][] = [];
    const api = createJarvis3Api({
      baseUrl: () => "https://i.example.org",
      authHeaders: () => null,
      credentials: "include",
      timeZone: () => "Europe/London",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push([url, init]);
        return {
          ok: true,
          status: 200,
          url,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({}),
        } as Response;
      }) as unknown as typeof fetch,
    });
    await api.listSchedules();
    await api.createSchedule({ prompt: "x", cron: "0 9 * * *", timeZone: "UTC" });
    await api.updateSchedule("s/1", { enabled: false });
    await api.runSchedule("s1");
    await api.previewSchedule({ cron: "0 9 * * *", timeZone: "UTC" });
    await api.deleteSchedule("s1");
    await api.listWakeups("t 1");
    await api.cancelWakeup("w1");
    await api.listChannels();
    await api.listPosts("t1");
    await api.markPostsRead("t1");
    expect(
      calls.map(([url, init]) => `${init.method} ${url.replace("https://i.example.org", "")}`),
    ).toEqual([
      "GET /api/schedules",
      "POST /api/schedules",
      "PATCH /api/schedules/s%2F1",
      "POST /api/schedules/s1/run",
      "POST /api/schedules/preview",
      "DELETE /api/schedules/s1",
      "GET /api/wakeups?taskId=t%201",
      "DELETE /api/wakeups/w1",
      "GET /api/channels",
      "GET /api/tasks/t1/posts",
      "POST /api/tasks/t1/posts/read",
    ]);
    const first = calls[0];
    if (!first) throw new Error("no call");
    expect((first[1].headers as Record<string, string>)["X-Time-Zone"]).toBe("Europe/London");
  });
});

describe("the admin's channel rows", () => {
  it("says unread by them on someone else's row, just unread on one's own", () => {
    expect(channelRecordHint(channel({ posts: 2, unread: 1, userId: "u2" }), "u1")).toBe(
      "2 posts, 1 unread by them",
    );
    expect(channelRecordHint(channel({ posts: 2, unread: 1, userId: "u1" }), "u1")).toBe(
      "2 posts, 1 unread",
    );
    expect(channelRecordHint(channel({ posts: 1, unread: 0, userId: "u2" }), "u1")).toBe("1 post");
  });
});

describe("Wake this task at…", () => {
  const now = new Date(2026, 9, 10, 16, 20, 0);

  it("opens on the next full hour, tomorrow when that crosses midnight", () => {
    expect(openWakeForm(now)).toEqual({ date: "2026-10-10", time: "17:00", message: "" });
    expect(openWakeForm(new Date(2026, 9, 10, 23, 30))).toMatchObject({
      date: "2026-10-11",
      time: "00:00",
    });
  });

  it("turns the device's date and time into the request, the message only when given", () => {
    const ok = checkWakeForm({ date: "2026-10-12", time: "9:05", message: "" }, now);
    if (!("request" in ok)) throw new Error(ok.error);
    expect(ok.request).toEqual({ at: new Date(2026, 9, 12, 9, 5).toISOString() });
    const withMessage = checkWakeForm(
      { date: "2026-10-12", time: "09:05", message: "  Send me the draft " },
      now,
    );
    expect("request" in withMessage && withMessage.request.prompt).toBe("Send me the draft");
  });

  it("refuses what the server would refuse, in words", () => {
    const error = (date: string, time: string, message = "") => {
      const r = checkWakeForm({ date, time, message }, now);
      return "error" in r ? r.error : null;
    };
    expect(error("12/10/2026", "09:00")).toMatch(/YYYY-MM-DD/);
    expect(error("2026-10-12", "9am")).toMatch(/HH:MM/);
    expect(error("2026-02-30", "09:00")).toMatch(/doesn't exist/);
    expect(error("2026-10-10", "16:20")).toMatch(/passed/);
    expect(error("2027-10-11", "09:00")).toMatch(/a year ahead/);
    expect(error("2026-10-12", "09:00", "x".repeat(4001))).toMatch(/4000 characters/);
  });

  it("the store arms it, then reloads the task's wakeups; a refusal comes back as its message", async () => {
    const armed: unknown[] = [];
    let listed = 0;
    const store = createTaskExtrasStore(
      {
        listChannels: async () => ({ channels: [] }),
        listPosts: async () => ({ posts: [] }),
        markPostsRead: async () => ({ unreadPosts: 0 }),
        listWakeups: async () => {
          listed += 1;
          return { wakeups: [wakeup({ setBy: "owner" })] };
        },
        cancelWakeup: async () => wakeup(),
        armWakeup: async (taskId, request) => {
          armed.push([taskId, request]);
          if (request.prompt === "too many") {
            throw new Jarvis3Error(
              "A task may have at most 10 armed wakeups.",
              429,
              "too_many_requests",
            );
          }
          return wakeup({ setBy: "owner" });
        },
      },
      { setUnreadPosts: () => undefined, refreshMe: async () => undefined },
    );
    expect(await store.armWakeup("t1", { at: "2026-10-12T08:00:00.000Z" })).toBeNull();
    expect(armed).toEqual([["t1", { at: "2026-10-12T08:00:00.000Z" }]]);
    expect(listed).toBe(1);
    expect(store.get().wakeups.t1?.wakeups[0]?.setBy).toBe("owner");
    expect(await store.armWakeup("t1", { at: "x", prompt: "too many" })).toMatch(/at most 10/);
    expect(listed).toBe(1);
  });
});
