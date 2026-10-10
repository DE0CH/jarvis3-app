// State for the Jarvis 3 screens: plain stores with injected dependencies (unit-tested in
// stores.test.ts); hooks.ts binds them to React with useSyncExternalStore.
import type { Jarvis3Api } from "./api";
import type {
  CreateTaskRequest,
  MeView,
  ModelList,
  NoticeView,
  PersonalLayerView,
  TaskView,
} from "./api-types";
import {
  Jarvis3Error,
  mergeTask,
  type SignOutReason,
  signOutReason,
  taskListNeedsRefresh,
} from "./plan";

export interface Store<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

function createState<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T>) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const REFRESH_WHILE_CHANGING_MS = 3_000;

// ---- tasks --------------------------------------------------------------------------------

export interface TasksState {
  loaded: boolean;
  refreshing: boolean;
  tasks: TaskView[];
  /** Tasks with an action in flight (Resume, Pause, Delete) from this app. */
  pending: Record<string, "resume" | "pause" | "delete">;
  error: string | null;
  signedOut: boolean;
}

export function createTasksStore(api: Jarvis3Api, timers: Timers) {
  const state = createState<TasksState>({
    loaded: false,
    refreshing: false,
    tasks: [],
    pending: {},
    error: null,
    signedOut: false,
  });
  let timer: unknown = null;
  let tail: Promise<void> = Promise.resolve();
  let active = false;

  function schedule(): void {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    if (!active) return;
    const { tasks, pending } = state.get();
    if (!taskListNeedsRefresh(tasks) && Object.keys(pending).length === 0) return;
    timer = timers.setTimeout(() => {
      timer = null;
      void refresh();
    }, REFRESH_WHILE_CHANGING_MS);
  }

  function fail(error: unknown): void {
    const signedOut = error instanceof Jarvis3Error && error.code === "signed_out";
    state.set({ error: messageOf(error), signedOut, refreshing: false });
  }

  function refresh(): Promise<void> {
    tail = tail.then(run, run);
    return tail;
  }

  async function run(): Promise<void> {
    state.set({ refreshing: true });
    try {
      const { tasks } = await api.listTasks();
      state.set({ tasks, loaded: true, refreshing: false, error: null, signedOut: false });
    } catch (error) {
      fail(error);
      state.set({ loaded: true });
    }
    schedule();
  }

  async function act(
    taskId: string,
    kind: "resume" | "pause" | "delete",
    call: () => Promise<TaskView>,
  ) {
    if (state.get().pending[taskId]) return;
    state.set({ pending: { ...state.get().pending, [taskId]: kind }, error: null });
    try {
      const task = await call();
      state.set({ tasks: mergeTask(state.get().tasks, task) });
    } catch (error) {
      fail(error);
    } finally {
      const { [taskId]: _done, ...rest } = state.get().pending;
      state.set({ pending: rest });
      schedule();
    }
  }

  return {
    get: state.get,
    subscribe: state.subscribe,
    refresh,
    /** The list screen is visible: refresh now, and keep refreshing while tasks change state. */
    activate() {
      active = true;
      void refresh();
    },
    deactivate() {
      active = false;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
    resume: (taskId: string) => act(taskId, "resume", () => api.resumeTask(taskId)),
    pause: (taskId: string) => act(taskId, "pause", () => api.pauseTask(taskId)),
    remove: (taskId: string) => act(taskId, "delete", () => api.deleteTask(taskId)),
    /** Creates a task; returns it, or throws a Jarvis3Error to show on the form. */
    async create(request: CreateTaskRequest): Promise<TaskView> {
      const task = await api.createTask(request);
      state.set({ tasks: mergeTask(state.get().tasks, task) });
      schedule();
      return task;
    },
    /** Puts a task fetched elsewhere (the chat screen) into the list. */
    upsert(task: TaskView) {
      state.set({ tasks: mergeTask(state.get().tasks, task) });
    },
  };
}

export type TasksStore = ReturnType<typeof createTasksStore>;

// ---- who am I, models -------------------------------------------------------------------

export interface AccountState {
  loaded: boolean;
  me: MeView | null;
  models: ModelList | null;
  error: string | null;
  signedOut: boolean;
  /** Why the instance refused this app (only when signedOut). */
  signOutReason: SignOutReason | null;
}

/** How often the unread notice count is refreshed while a Jarvis screen is open. */
export const REFRESH_ME_MS = 60_000;

export function createAccountStore(api: Jarvis3Api, timers?: Timers) {
  const state = createState<AccountState>({
    loaded: false,
    me: null,
    models: null,
    error: null,
    signedOut: false,
    signOutReason: null,
  });
  let inflight: Promise<void> | null = null;
  let watchers = 0;
  let timer: unknown = null;
  const refusal = (error: unknown) => {
    const reason = signOutReason(error);
    return { signedOut: reason !== null, signOutReason: reason };
  };
  const schedule = () => {
    if (!timers || watchers === 0 || timer !== null) return;
    timer = timers.setTimeout(() => {
      timer = null;
      void refreshMe().finally(schedule);
    }, REFRESH_ME_MS);
  };
  async function refreshMe(): Promise<void> {
    try {
      const me = await api.me();
      state.set({ me });
    } catch (error) {
      const refused = refusal(error);
      if (refused.signedOut) state.set({ ...refused, error: messageOf(error) });
    }
  }
  return {
    get: state.get,
    subscribe: state.subscribe,
    load(force = false): Promise<void> {
      if (inflight) return inflight;
      if (state.get().loaded && !force && !state.get().error) return Promise.resolve();
      inflight = (async () => {
        try {
          const [me, models] = await Promise.all([api.me(), api.models()]);
          state.set({
            loaded: true,
            me,
            models,
            error: null,
            signedOut: false,
            signOutReason: null,
          });
        } catch (error) {
          state.set({ loaded: true, error: messageOf(error), ...refusal(error) });
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    },
    /** Keep `me` (the unread notice count) fresh while something shows it. Returns the stop. */
    watch(): () => void {
      watchers += 1;
      schedule();
      return () => {
        watchers -= 1;
        if (watchers === 0 && timer !== null) {
          timers?.clearTimeout(timer);
          timer = null;
        }
      };
    },
    refreshMe,
    setUnread(unreadNotices: number) {
      const me = state.get().me;
      if (me && me.unreadNotices !== unreadNotices) state.set({ me: { ...me, unreadNotices } });
    },
    setUnreadPosts(unreadPosts: number) {
      const me = state.get().me;
      if (me && me.unreadPosts !== unreadPosts) state.set({ me: { ...me, unreadPosts } });
    },
  };
}

export type AccountStore = ReturnType<typeof createAccountStore>;

// ---- personal layer -----------------------------------------------------------------------

export interface LayerState {
  loaded: boolean;
  layer: PersonalLayerView | null;
  busy: boolean;
  error: string | null;
  /** Shown after Reset: the archived version, with Undo. null when nothing was archived. */
  lastReset: { version: number | null } | null;
  /** A one-line confirmation after a change ("Saved. Applies from your next task."). */
  notice: string | null;
}

export const APPLIES_NEXT_TASK = "Saved. Applies from your next task.";

export function createLayerStore(api: Jarvis3Api) {
  const state = createState<LayerState>({
    loaded: false,
    layer: null,
    busy: false,
    error: null,
    lastReset: null,
    notice: null,
  });

  async function mutate(
    call: () => Promise<PersonalLayerView | null>,
    after?: Partial<LayerState>,
  ): Promise<boolean> {
    if (state.get().busy) return false;
    state.set({ busy: true, error: null, notice: null });
    try {
      const layer = await call();
      state.set({ ...(layer ? { layer } : {}), busy: false, notice: APPLIES_NEXT_TASK, ...after });
      return true;
    } catch (error) {
      state.set({ busy: false, error: messageOf(error) });
      return false;
    }
  }

  return {
    get: state.get,
    subscribe: state.subscribe,
    async load(): Promise<void> {
      try {
        const layer = await api.getLayer();
        state.set({ loaded: true, layer, error: null });
      } catch (error) {
        state.set({ loaded: true, error: messageOf(error) });
      }
    },
    setInstructions: (text: string) => mutate(() => api.setInstructions(text)),
    putSkill: (name: string, files: Record<string, string>) =>
      mutate(() => api.putSkill(name, files)),
    deleteSkill: (name: string) => mutate(() => api.deleteSkill(name)),
    addNote: (text: string) =>
      mutate(async () => {
        await api.addNote(text);
        return api.getLayer();
      }),
    deleteNote: (noteId: string) => mutate(() => api.deleteNote(noteId)),
    /** Reset to company default: the layer is archived as a version (Undo brings it back). */
    reset: () =>
      mutate(async () => {
        const result = await api.resetLayer();
        state.set({ lastReset: { version: result.version } });
        return result.layer;
      }),
    undo: () => mutate(() => api.undoLayer(), { lastReset: null }),
    dismissReset() {
      state.set({ lastReset: null });
    },
  };
}

export type LayerStore = ReturnType<typeof createLayerStore>;

// ---- notices --------------------------------------------------------------------------------

export interface NoticesState {
  loaded: boolean;
  notices: NoticeView[];
  error: string | null;
}

/** The notices screen: loading the list marks it read up to the newest one shown. */
export function createNoticesStore(api: Jarvis3Api, account: Pick<AccountStore, "setUnread">) {
  const state = createState<NoticesState>({ loaded: false, notices: [], error: null });
  return {
    get: state.get,
    subscribe: state.subscribe,
    async load(): Promise<void> {
      try {
        const { notices } = await api.notices();
        state.set({ loaded: true, notices, error: null });
        const newest = notices[0];
        if (newest && notices.some((notice) => !notice.read)) {
          const { unreadNotices } = await api.markNoticesRead(newest.id);
          account.setUnread(unreadNotices);
        } else if (!newest) account.setUnread(0);
      } catch (error) {
        state.set({ loaded: true, error: messageOf(error) });
      }
    },
  };
}

export type NoticesStore = ReturnType<typeof createNoticesStore>;
