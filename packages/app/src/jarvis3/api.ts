// The Jarvis 3 instance API (docs/API.md in DE0CH/jarvis3), as used by the app.
// Transport-agnostic: the base URL, the credentials and fetch are injected, so it is unit-tested
// with a fake fetch (api.test.ts) and used with the real one in client.ts.
import type {
  AddNoteRequest,
  ArchiveLink,
  ApprovalList,
  ApprovalView,
  ChannelList,
  ChannelPostList,
  CreateScheduleRequest,
  CreateTaskRequest,
  DecideRequest,
  FileLink,
  FileList,
  FileView,
  MarkNoticesReadRequest,
  MarkNoticesReadResult,
  MarkPostsReadResult,
  MeView,
  ModelList,
  MoveFileRequest,
  NoticeList,
  PersonalLayerView,
  PersonalNote,
  PutSkillRequest,
  ResetResult,
  ScheduleDetail,
  ScheduleList,
  SchedulePreview,
  SchedulePreviewRequest,
  ScheduleRunNowResult,
  ScheduleView,
  SearchResult,
  SetInstructionsRequest,
  SetLimitsRequest,
  SuggestionList,
  SuggestionView,
  SuggestRequest,
  TaskList,
  TaskView,
  ToolsAdminView,
  TranscriptPage,
  UpdateScheduleRequest,
  UserDetail,
  UserList,
  WakeupList,
  WakeupView,
} from "./api-types";
import { encodeFilePath } from "./files";
import { errorFromResponse, isAccessRefusal, Jarvis3Error } from "./plan";

/** A file's bytes for an upload (PUT /api/users/:id/files/<path>). */
export interface UploadBody {
  bytes: Uint8Array;
  contentType: string;
}

/** GET /api/search: own tasks by default; `userId` (owner or admin) or `all` (admin). */
export interface SearchQuery {
  q: string;
  limit?: number;
  taskId?: string;
  userId?: string;
  all?: boolean;
}

/** GET /api/tasks/:id/transcript: one cursor at most (none = from the beginning). */
export interface TranscriptQuery {
  agentId?: string;
  around?: number;
  before?: number;
  after?: number;
  limit?: number;
}

function queryString(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === false || value === "") continue;
    params.set(key, value === true ? "1" : String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export interface Jarvis3ApiDeps {
  baseUrl: () => string | null;
  /** iOS: the paired device's Access service token headers. Web: null (the Access cookie). */
  authHeaders: () => Record<string, string> | null;
  /** "include" on the web (same origin, the Access cookie), "omit" on iOS. */
  credentials: "include" | "omit";
  fetch: typeof fetch;
  /** The device's IANA time zone, sent as `X-Time-Zone` (schedules and wakeups use it). */
  timeZone?: () => string | null;
}

export type Jarvis3Api = ReturnType<typeof createJarvis3Api>;

export function createJarvis3Api(deps: Jarvis3ApiDeps) {
  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    upload?: UploadBody,
  ): Promise<T> {
    const base = deps.baseUrl();
    if (!base) throw new Jarvis3Error("This app has no instance URL.", 0, "signed_out");
    const headers: Record<string, string> = { Accept: "application/json", ...deps.authHeaders() };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const zone = deps.timeZone?.();
    if (zone) headers["X-Time-Zone"] = zone;
    if (upload) headers["Content-Type"] = upload.contentType || "application/octet-stream";
    let payload: { body: string | Uint8Array } | null = null;
    if (upload) payload = { body: upload.bytes };
    else if (body !== undefined) payload = { body: JSON.stringify(body) };
    let response: Response;
    try {
      response = await deps.fetch(base + path, {
        method,
        headers,
        credentials: deps.credentials,
        ...(payload as RequestInit | null),
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
  const filesPath = (userId: string) => `/api/users/${id(userId)}/files`;

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
    /** `pending`: only what the caller can decide now. `taskId`: one task's approvals. */
    listApprovals: (query: { pending?: boolean; taskId?: string } = {}) => {
      const params = new URLSearchParams();
      if (query.pending) params.set("pending", "1");
      if (query.taskId) params.set("taskId", query.taskId);
      const search = params.toString();
      return call<ApprovalList>("GET", `/api/approvals${search ? `?${search}` : ""}`);
    },
    getApproval: (approvalId: string) =>
      call<ApprovalView>("GET", `/api/approvals/${id(approvalId)}`),
    decideApproval: (approvalId: string, request: DecideRequest) =>
      call<ApprovalView>("POST", `/api/approvals/${id(approvalId)}/decide`, request),

    // Scheduled tasks, wakeups and channels (docs/API.md section 15).
    listSchedules: () => call<ScheduleList>("GET", "/api/schedules"),
    getSchedule: (scheduleId: string) =>
      call<ScheduleDetail>("GET", `/api/schedules/${id(scheduleId)}`),
    createSchedule: (request: CreateScheduleRequest) =>
      call<ScheduleView>("POST", "/api/schedules", request),
    updateSchedule: (scheduleId: string, request: UpdateScheduleRequest) =>
      call<ScheduleView>("PATCH", `/api/schedules/${id(scheduleId)}`, request),
    deleteSchedule: (scheduleId: string) =>
      call<unknown>("DELETE", `/api/schedules/${id(scheduleId)}`),
    runSchedule: (scheduleId: string) =>
      call<ScheduleRunNowResult>("POST", `/api/schedules/${id(scheduleId)}/run`),
    previewSchedule: (request: SchedulePreviewRequest) =>
      call<SchedulePreview>("POST", "/api/schedules/preview", request),
    listWakeups: (taskId: string) => call<WakeupList>("GET", `/api/wakeups?taskId=${id(taskId)}`),
    cancelWakeup: (wakeupId: string) => call<WakeupView>("DELETE", `/api/wakeups/${id(wakeupId)}`),
    listChannels: () => call<ChannelList>("GET", "/api/channels"),
    listPosts: (taskId: string) => call<ChannelPostList>("GET", `/api/tasks/${id(taskId)}/posts`),
    markPostsRead: (taskId: string) =>
      call<MarkPostsReadResult>("POST", `/api/tasks/${id(taskId)}/posts/read`),

    listUsers: () => call<UserList>("GET", "/api/users"),
    /** Admin: the instance's Tier 0 providers and this month's totals. */
    toolsAdmin: () => call<ToolsAdminView>("GET", "/api/admin/tools"),
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

    /** A user's files (`me`, or another user's for an admin). */
    listFiles: (userId = "me") => call<FileList>("GET", filesPath(userId)),
    /** Creates or replaces the file at `path` with these bytes. */
    uploadFile: (path: string, upload: UploadBody, userId = "me") =>
      call<FileView>("PUT", `${filesPath(userId)}/${encodeFilePath(path)}`, undefined, upload),
    /** A short-lived download link (always a download, never shown inline). */
    fileLink: (path: string, userId = "me") =>
      call<FileLink>("GET", `${filesPath(userId)}/${encodeFilePath(path)}?link=1`),
    deleteFile: (path: string, userId = "me") =>
      call<{ ok: true }>("DELETE", `${filesPath(userId)}/${encodeFilePath(path)}`),
    moveFile: (from: string, to: string, userId = "me") =>
      call<FileView>("POST", `${filesPath(userId)}/move`, { from, to } satisfies MoveFileRequest),

    search: (query: SearchQuery) =>
      call<SearchResult>(
        "GET",
        `/api/search${queryString({
          q: query.q,
          limit: query.limit,
          taskId: query.taskId,
          userId: query.userId,
          all: query.all,
        })}`,
      ),
    transcript: (taskId: string, query: TranscriptQuery = {}) =>
      call<TranscriptPage>(
        "GET",
        `/api/tasks/${id(taskId)}/transcript${queryString({
          agentId: query.agentId,
          around: query.around,
          before: query.before,
          after: query.after,
          limit: query.limit,
        })}`,
      ),
  };
}
