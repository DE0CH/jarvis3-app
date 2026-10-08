import { describe, expect, it, vi } from "vitest";
import { createJarvis3Api, type Jarvis3Api } from "./api";
import type { PersonalLayerView, TaskView } from "./api-types";
import { Jarvis3Error } from "./plan";
import {
  APPLIES_NEXT_TASK,
  createAccountStore,
  createLayerStore,
  createTasksStore,
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
  it("loads the list and keeps refreshing only while something changes", async () => {
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
    expect(pending).toHaveLength(0);
    store.deactivate();
  });

  it("resumes a paused task, marks it pending meanwhile, and merges the answer", async () => {
    let release: (value: TaskView) => void = () => undefined;
    const resumeTask = vi.fn(() => new Promise<TaskView>((resolve) => (release = resolve)));
    const store = createTasksStore(
      fakeApi({
        listTasks: async () => ({ tasks: [task({ state: "paused", connected: false })] }),
        resumeTask,
      }),
      fakeTimers().timers,
    );
    await store.refresh();
    const done = store.resume("t1");
    expect(store.get().pending).toEqual({ t1: "resume" });
    void store.resume("t1");
    expect(resumeTask).toHaveBeenCalledTimes(1);
    release(task({ state: "starting", busy: { kind: "resuming", since: "x" }, connected: false }));
    await done;
    expect(store.get().pending).toEqual({});
    expect(store.get().tasks[0]?.state).toBe("starting");
  });

  it("reports a cap refusal on Start", async () => {
    const store = createTasksStore(
      fakeApi({
        listTasks: async () => ({ tasks: [task({ state: "paused", connected: false })] }),
        resumeTask: async () => {
          throw new Jarvis3Error(
            "Your machine hours for this month are used up.",
            429,
            "machine_hours_cap",
          );
        },
      }),
      fakeTimers().timers,
    );
    await store.refresh();
    await store.resume("t1");
    expect(store.get().error).toMatch(/machine hours/);
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
