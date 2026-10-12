import { describe, expect, it, vi } from "vitest";
import { createJarvis3Api, type Jarvis3Api } from "./api";
import type { MeView, NoticeView, PersonalLayerView, TaskView } from "./api-types";
import { Jarvis3Error } from "./plan";
import {
  APPLIES_NEXT_TASK,
  createAccountStore,
  createLayerStore,
  createNoticesStore,
  createTasksStore,
  REFRESH_IDLE_MS,
  REFRESH_ME_MS,
  REFRESH_WHILE_CHANGING_MS,
  type Timers,
} from "./stores";

function task(patch: Partial<TaskView> = {}): TaskView {
  return {
    id: "t1",
    userId: "u1",
    title: "Task",
    model: "m",
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

function layer(patch: Partial<PersonalLayerView> = {}): PersonalLayerView {
  return { instructions: "", skills: [], notes: [], versions: [], updatedAt: null, ...patch };
}

function jsonResponse(status: number, body: unknown, url = "https://i.example.org/x"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as Response;
}

function fakeTimers() {
  const pending: { fn: () => void; ms: number }[] = [];
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      const entry = { fn, ms };
      pending.push(entry);
      return entry;
    },
    clearTimeout: (handle) => {
      const index = pending.indexOf(handle as (typeof pending)[number]);
      if (index >= 0) pending.splice(index, 1);
    },
  };
  return { timers, pending };
}

describe("createJarvis3Api", () => {
  it("sends the device headers and omits cookies on iOS", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { tasks: [] }));
    const api = createJarvis3Api({
      baseUrl: () => "https://i.example.org",
      authHeaders: () => ({ "CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "secret" }),
      credentials: "omit",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await api.listTasks();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://i.example.org/api/tasks");
    expect(init.credentials).toBe("omit");
    expect((init.headers as Record<string, string>)["CF-Access-Client-Id"]).toBe("id");
  });

  it("uses the Access cookie on the web and the personal layer routes of 'me'", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, layer()));
    const api = createJarvis3Api({
      baseUrl: () => "https://i.example.org",
      authHeaders: () => null,
      credentials: "include",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await api.putSkill("invoices", { "SKILL.md": "x" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://i.example.org/api/users/me/layer/skills/invoices");
    expect(init.method).toBe("PUT");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({ files: { "SKILL.md": "x" } });
  });

  it("turns an error body into a Jarvis3Error and a network failure into 'network'", async () => {
    const api404 = createJarvis3Api({
      baseUrl: () => "https://i.example.org",
      authHeaders: () => null,
      credentials: "include",
      fetch: (async () =>
        jsonResponse(404, {
          error: { code: "not_found", message: "no such task" },
        })) as typeof fetch,
    });
    await expect(api404.getTask("x")).rejects.toMatchObject({ code: "not_found", status: 404 });
    const apiDown = createJarvis3Api({
      baseUrl: () => "https://i.example.org",
      authHeaders: () => null,
      credentials: "include",
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as typeof fetch,
    });
    await expect(apiDown.me()).rejects.toMatchObject({ code: "network" });
  });

  it("uses the suggestion, admin and archive-link routes", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, {}));
    const api = createJarvis3Api({
      baseUrl: () => "https://i.example.org",
      authHeaders: () => null,
      credentials: "include",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await api.suggest({ kind: "skill", name: "invoices" });
    await api.listSuggestions();
    await api.listSuggestions({ all: true });
    await api.listUserTasks("u 1");
    await api.getUserLayer("u1");
    await api.archiveLink("t1");
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(
      calls.map(([url, init]) => `${init.method} ${url.replace("https://i.example.org", "")}`),
    ).toEqual([
      "POST /api/users/me/layer/suggest",
      "GET /api/suggestions",
      "GET /api/suggestions?all=1",
      "GET /api/tasks?userId=u%201",
      "GET /api/users/u1/layer",
      "GET /api/tasks/t1/archive?link=1",
    ]);
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({ kind: "skill", name: "invoices" });
  });

  it("treats Access's login page as signed out", async () => {
    const api = createJarvis3Api({
      baseUrl: () => "https://i.example.org",
      authHeaders: () => null,
      credentials: "include",
      fetch: (async () =>
        ({
          ok: true,
          status: 200,
          url: "https://team.cloudflareaccess.com/cdn-cgi/access/login/i.example.org",
          headers: new Headers({ "content-type": "text/html" }),
          json: async () => null,
        }) as Response) as typeof fetch,
    });
    await expect(api.me()).rejects.toMatchObject({ code: "signed_out" });
  });
});

function fakeApi(overrides: Partial<Jarvis3Api>): Jarvis3Api {
  return new Proxy(overrides as Jarvis3Api, {
    get(target, key: string) {
      const value = (target as Record<string, unknown>)[key];
      if (value) return value;
      return () => Promise.reject(new Error(`unexpected call ${key}`));
    },
  });
}

describe("tasks store", () => {
  it("refreshes fast while something changes and slowly otherwise", async () => {
    let tasks = [task({ state: "starting", connected: false })];
    const { timers, pending } = fakeTimers();
    const store = createTasksStore(fakeApi({ listTasks: async () => ({ tasks }) }), timers);
    store.activate();
    await store.refresh();
    expect(store.get().loaded).toBe(true);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.ms).toBe(REFRESH_WHILE_CHANGING_MS);
    tasks = [task()];
    pending.shift()?.fn();
    await store.refresh();
    expect(store.get().tasks[0]?.state).toBe("running");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.ms).toBe(REFRESH_IDLE_MS);
    store.deactivate();
  });

  it("keeps refreshing until the last viewer leaves", async () => {
    const { timers, pending } = fakeTimers();
    const store = createTasksStore(fakeApi({ listTasks: async () => ({ tasks: [] }) }), timers);
    store.activate();
    store.activate();
    await store.refresh();
    store.deactivate();
    expect(pending.length).toBeGreaterThan(0);
  });

  it("renames a chat, marks it pending meanwhile, and merges the answer", async () => {
    let release: (value: TaskView) => void = () => undefined;
    const renameTask = vi.fn(() => new Promise<TaskView>((resolve) => (release = resolve)));
    const store = createTasksStore(
      fakeApi({ listTasks: async () => ({ tasks: [task()] }), renameTask }),
      fakeTimers().timers,
    );
    await store.refresh();
    const done = store.rename("t1", "Weekly report");
    expect(store.get().pending).toEqual({ t1: "rename" });
    void store.rename("t1", "Again");
    expect(renameTask).toHaveBeenCalledTimes(1);
    expect(renameTask).toHaveBeenCalledWith("t1", { title: "Weekly report" });
    release(task({ title: "Weekly report", titleSetByUser: true }));
    expect(await done).toBeNull();
    expect(store.get().pending).toEqual({});
    expect(store.get().tasks[0]?.title).toBe("Weekly report");
  });

  it("deletes a chat and returns the refusal's message", async () => {
    const store = createTasksStore(
      fakeApi({
        listTasks: async () => ({ tasks: [task()] }),
        deleteTask: async () => {
          throw new Jarvis3Error("Task is pausing — try again", 409, "busy");
        },
      }),
      fakeTimers().timers,
    );
    await store.refresh();
    expect(await store.remove("t1")).toMatch(/try again/);
    expect(store.get().error).toMatch(/try again/);
  });

  it("puts a created task at the top", async () => {
    const created = task({ id: "new", state: "starting", connected: false });
    const createTask = vi.fn(async () => created);
    const store = createTasksStore(
      fakeApi({ listTasks: async () => ({ tasks: [task()] }), createTask }),
      fakeTimers().timers,
    );
    await store.refresh();
    expect(await store.create({ prompt: "hi", requestId: "r1" })).toBe(created);
    expect(createTask).toHaveBeenCalledWith({ prompt: "hi", requestId: "r1" });
    expect(store.get().tasks.map((t) => t.id)).toEqual(["new", "t1"]);
  });
});

describe("account store", () => {
  it("marks a forbidden account as signed out", async () => {
    const store = createAccountStore(
      fakeApi({
        me: async () => {
          throw new Jarvis3Error("no access", 403, "forbidden");
        },
        models: async () => ({ models: [], default: "" }),
      }),
    );
    await store.load();
    expect(store.get()).toMatchObject({ loaded: true, signedOut: true });
  });
});

function me(unreadNotices: number): MeView {
  return {
    user: {
      id: "u1",
      email: "a@example.org",
      name: "A",
      role: "staff",
      status: "active",
      isAdmin: false,
      createdAt: "t",
    },
    limits: {
      openrouterMonthlyUsd: 20,
      openrouterOverride: false,
      machineHoursPerMonth: 10,
      machineHoursOverride: false,
    },
    usage: {
      month: "2026-10",
      machineHours: 0,
      machineHoursCapReached: false,
      openrouterKey: true,
    },
    unreadNotices,
    pendingApprovals: 0,
    isOwner: false,
  };
}

describe("account store: why access was refused, and the unread count", () => {
  it("tells a revoked device apart", async () => {
    const store = createAccountStore(
      fakeApi({
        me: async () => {
          throw new Jarvis3Error("revoked", 403, "device_revoked");
        },
        models: async () => ({ models: [], default: "" }),
      }),
    );
    await store.load();
    expect(store.get()).toMatchObject({ signedOut: true, signOutReason: "revoked" });
  });
  it("refreshes me while watched, and stops when nothing watches", async () => {
    let unread = 1;
    const { timers, pending } = fakeTimers();
    const store = createAccountStore(
      fakeApi({ me: async () => me(unread), models: async () => ({ models: [], default: "" }) }),
      timers,
    );
    await store.load();
    expect(store.get().me?.unreadNotices).toBe(1);
    const stop = store.watch();
    expect(pending.map((p) => p.ms)).toEqual([REFRESH_ME_MS]);
    unread = 4;
    pending.shift()!.fn();
    await vi.waitFor(() => expect(store.get().me?.unreadNotices).toBe(4));
    await vi.waitFor(() => expect(pending.length).toBe(1), { timeout: 1000 });
    stop();
    expect(pending.length).toBe(0);
    store.setUnread(0);
    expect(store.get().me?.unreadNotices).toBe(0);
  });
});

describe("notices store", () => {
  const notice = (id: string, read: boolean): NoticeView => ({
    id,
    kind: "task_failed",
    text: id,
    taskId: null,
    createdAt: "2026-10-08T12:00:00.000Z",
    read,
  });
  it("loads the list and marks it read up to the newest notice", async () => {
    const markNoticesRead = vi.fn(async () => ({ unreadNotices: 0 }));
    const setUnread = vi.fn();
    const store = createNoticesStore(
      fakeApi({
        notices: async () => ({ notices: [notice("n2", false), notice("n1", true)] }),
        markNoticesRead,
      }),
      { setUnread },
    );
    await store.load();
    expect(store.get().notices.map((n) => n.id)).toEqual(["n2", "n1"]);
    expect(store.get().notices[0]?.read).toBe(false);
    expect(markNoticesRead).toHaveBeenCalledWith("n2");
    expect(setUnread).toHaveBeenCalledWith(0);
  });
  it("doesn't mark anything when all are read", async () => {
    const markNoticesRead = vi.fn(async () => ({ unreadNotices: 0 }));
    const store = createNoticesStore(
      fakeApi({ notices: async () => ({ notices: [notice("n1", true)] }), markNoticesRead }),
      {
        setUnread: vi.fn(),
      },
    );
    await store.load();
    expect(markNoticesRead).not.toHaveBeenCalled();
  });
});

describe("layer store", () => {
  it("saves instructions and says the change applies from the next task", async () => {
    const store = createLayerStore(
      fakeApi({
        getLayer: async () => layer(),
        setInstructions: async (text: string) => layer({ instructions: text, updatedAt: "now" }),
      }),
    );
    await store.load();
    expect(await store.setInstructions("Answer in German.")).toBe(true);
    expect(store.get().layer?.instructions).toBe("Answer in German.");
    expect(store.get().notice).toBe(APPLIES_NEXT_TASK);
  });

  it("resets to the company default and undoes it", async () => {
    const full = layer({ instructions: "German", updatedAt: "t0" });
    const store = createLayerStore(
      fakeApi({
        getLayer: async () => full,
        resetLayer: async () => ({
          version: 1,
          layer: layer({
            versions: [{ version: 1, createdAt: "t1", reason: "reset" }],
            updatedAt: "t1",
          }),
        }),
        undoLayer: async () => ({
          ...full,
          versions: [{ version: 1, createdAt: "t1", reason: "reset" }],
        }),
      }),
    );
    await store.load();
    expect(await store.reset()).toBe(true);
    expect(store.get().lastReset).toEqual({ version: 1 });
    expect(store.get().layer?.instructions).toBe("");
    expect(await store.undo()).toBe(true);
    expect(store.get().lastReset).toBeNull();
    expect(store.get().layer?.instructions).toBe("German");
  });

  it("adds a note and reloads the layer", async () => {
    let notes: PersonalLayerView["notes"] = [];
    const store = createLayerStore(
      fakeApi({
        getLayer: async () => layer({ notes }),
        addNote: async (text: string) => {
          const note = { id: "n1", text, createdAt: "x", source: "user" as const, taskId: null };
          notes = [note];
          return note;
        },
      }),
    );
    await store.load();
    await store.addNote("My manager is Dana.");
    expect(store.get().layer?.notes.map((n) => n.text)).toEqual(["My manager is Dana."]);
  });

  it("keeps the error and ignores a second change while one is saving", async () => {
    let release: () => void = () => undefined;
    const store = createLayerStore(
      fakeApi({
        getLayer: async () => layer(),
        deleteSkill: () =>
          new Promise((_, reject) => {
            release = () => reject(new Error("Not found."));
          }),
      }),
    );
    await store.load();
    const first = store.deleteSkill("x");
    expect(await store.deleteSkill("y")).toBe(false);
    release();
    expect(await first).toBe(false);
    expect(store.get().error).toBe("Not found.");
  });
});
