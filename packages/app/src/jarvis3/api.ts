// The Jarvis 3 instance API (docs/API.md in DE0CH/jarvis3), as used by the app.
// Transport-agnostic: the base URL, the credentials and fetch are injected, so it is unit-tested
// with a fake fetch (api.test.ts) and used with the real one in client.ts.
import type {
  AddNoteRequest,
  ArchiveLink,
  CreateTaskRequest,
  MarkNoticesReadRequest,
  MarkNoticesReadResult,
  MeView,
  ModelList,
  NoticeList,
  PersonalLayerView,
  PersonalNote,
  PutSkillRequest,
  ResetResult,
  SetInstructionsRequest,
  SetLimitsRequest,
  SuggestionList,
  SuggestionView,
  SuggestRequest,
  TaskList,
  TaskView,
  UserDetail,
  UserList,
} from "./api-types";
import { errorFromResponse, isAccessRefusal, Jarvis3Error } from "./plan";

export interface Jarvis3ApiDeps {
  baseUrl: () => string | null;
  /** iOS: the paired device's Access service token headers. Web: null (the Access cookie). */
  authHeaders: () => Record<string, string> | null;
  /** "include" on the web (same origin, the Access cookie), "omit" on iOS. */
  credentials: "include" | "omit";
  fetch: typeof fetch;
}

export type Jarvis3Api = ReturnType<typeof createJarvis3Api>;

export function createJarvis3Api(deps: Jarvis3ApiDeps) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const base = deps.baseUrl();
    if (!base) throw new Jarvis3Error("This app has no instance URL.", 0, "signed_out");
    const headers: Record<string, string> = { Accept: "application/json", ...deps.authHeaders() };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await deps.fetch(base + path, {
        method,
        headers,
        credentials: deps.credentials,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      // On the web an expired Access session turns into a cross-origin redirect, which fetch
      // reports as a network error.
      throw new Jarvis3Error(
        "No answer from the instance. Check your connection, or reload to sign in again.",
        0,
        "network",
      );
    }
    const contentType = response.headers.get("content-type");
    if (
      isAccessRefusal({
        finalUrl: response.url || base + path,
        status: response.status,
        contentType,
      })
    ) {
      throw new Jarvis3Error("You're signed out.", 401, "signed_out");
    }
    const json: unknown = contentType?.includes("application/json")
      ? await response.json().catch(() => null)
      : null;
    if (!response.ok) throw errorFromResponse(response.status, json);
    return json as T;
  }

  const id = (value: string) => encodeURIComponent(value);
  const me = "/api/users/me";

  return {
    me: () => call<MeView>("GET", "/api/me"),
    models: () => call<ModelList>("GET", "/api/models"),
    notices: () => call<NoticeList>("GET", "/api/notices"),
    /** Marks the caller's notices read: all, or up to (and including) notice `upTo`. */
    markNoticesRead: (upTo?: string) =>
      call<MarkNoticesReadResult>(
        "POST",
        "/api/notices/read",
        (upTo ? { upTo } : {}) satisfies MarkNoticesReadRequest,
      ),

    listTasks: () => call<TaskList>("GET", "/api/tasks"),
    getTask: (taskId: string) => call<TaskView>("GET", `/api/tasks/${id(taskId)}`),
    createTask: (request: CreateTaskRequest) => call<TaskView>("POST", "/api/tasks", request),
    pauseTask: (taskId: string) => call<TaskView>("POST", `/api/tasks/${id(taskId)}/pause`),
    resumeTask: (taskId: string) => call<TaskView>("POST", `/api/tasks/${id(taskId)}/resume`),
    deleteTask: (taskId: string) => call<TaskView>("DELETE", `/api/tasks/${id(taskId)}`),

    getLayer: () => call<PersonalLayerView>("GET", `${me}/layer`),
    setInstructions: (text: string) =>
      call<PersonalLayerView>("PUT", `${me}/layer/instructions`, {
        text,
      } satisfies SetInstructionsRequest),
    putSkill: (name: string, files: Record<string, string>) =>
      call<PersonalLayerView>("PUT", `${me}/layer/skills/${id(name)}`, {
        files,
      } satisfies PutSkillRequest),
    deleteSkill: (name: string) =>
      call<PersonalLayerView>("DELETE", `${me}/layer/skills/${id(name)}`),
    addNote: (text: string) =>
      call<PersonalNote>("POST", `${me}/layer/notes`, { text } satisfies AddNoteRequest),
    deleteNote: (noteId: string) =>
      call<PersonalLayerView>("DELETE", `${me}/layer/notes/${id(noteId)}`),
    resetLayer: () => call<ResetResult>("POST", `${me}/layer/reset`),
    undoLayer: () => call<PersonalLayerView>("POST", `${me}/layer/undo`),

    /** "Suggest for everyone": a pull request on the org-env repo from part of the caller's layer. */
    suggest: (request: SuggestRequest) =>
      call<SuggestionView>("POST", `${me}/layer/suggest`, request),
    /** The caller's suggestions, or with `all` (admins) everyone's. */
    listSuggestions: (scope: { all?: boolean } = {}) =>
      call<SuggestionList>("GET", scope.all ? "/api/suggestions?all=1" : "/api/suggestions"),

    listUsers: () => call<UserList>("GET", "/api/users"),
    /** Admin: a user's tasks, archived ones included (an offboarded person's sessions). */
    listUserTasks: (userId: string) => call<TaskList>("GET", `/api/tasks?userId=${id(userId)}`),
    /** Admin: a user's personal layer (kept after offboarding). */
    getUserLayer: (userId: string) =>
      call<PersonalLayerView>("GET", `/api/users/${id(userId)}/layer`),
    /** A short-lived download link for an archived task's state. */
    archiveLink: (taskId: string) =>
      call<ArchiveLink>("GET", `/api/tasks/${id(taskId)}/archive?link=1`),
    setLimits: (userId: string, limits: SetLimitsRequest) =>
      call<UserDetail>("PATCH", `/api/users/${id(userId)}/limits`, limits),
  };
}
