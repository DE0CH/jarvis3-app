// The Jarvis 3 instance API (docs/API.md in DE0CH/jarvis3), as used by the app.
// Transport-agnostic: the base URL, the credentials and fetch are injected, so it is unit-tested
// with a fake fetch (api.test.ts) and used with the real one in client.ts.
import type {
  AddNoteRequest,
  ArmWakeupRequest,
  ArchiveLink,
  ApprovalList,
  ApprovalView,
  ChannelList,
  ChannelPostList,
  CreatePushSubscriptionRequest,
  CreateScheduleRequest,
  CreateProjectRequest,
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
  ProjectList,
  ProjectView,
  PushSettings,
  PushSubscriptionView,
  PushTestResult,
  PutSkillRequest,
  ResetResult,
  ScheduleDetail,
  ScheduleList,
  SchedulePreview,
  SchedulePreviewRequest,
  ScheduleRunNowResult,
  ScheduleView,
  SearchResult,
  SendMessageRequest,
  SendMessageResult,
  SetInstructionsRequest,
  SetLimitsRequest,
  SetPushKindsRequest,
  SuggestionList,
  SuggestionView,
  SuggestRequest,
  TaskList,
  TaskView,
  ToolsAdminView,
  TranscriptPage,
  UpdateProjectRequest,
  UpdateScheduleRequest,
  UpdateTaskRequest,
  UserDetail,
  UserList,
  WakeupList,
  WakeupView,
} from "./api-types";
import { encodeFilePath } from "./files";
import { errorFromResponse, isAccessRefusal, Jarvis3Error } from "./plan";

/**
 * What an upload sends (PUT /api/users/:id/files/<path>), never read into memory whole when it can
 * be streamed: the web's picked `File` (the browser streams a Blob body from disk), a file on the
 * device (iOS: uploaded from disk by the native uploader), or bytes already in memory.
 */
export type UploadSource =
  | { kind: "blob"; blob: Blob }
  | { kind: "file"; uri: string; size: number }
  | { kind: "bytes"; bytes: Uint8Array };

export interface UploadBody {
  source: UploadSource;
  contentType: string;
}

export function uploadSize(source: UploadSource): number {
  if (source.kind === "blob") return source.blob.size;
  if (source.kind === "file") return source.size;
  return source.bytes.byteLength;
}

/** The answer of a native file upload, enough to read it like a fetch Response. */
export interface FileUploadResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** iOS: PUT a file from disk with these headers, streamed by the platform (not read into JS). */
export type FileUploader = (
  url: string,
  uri: string,
  headers: Record<string, string>,
) => Promise<FileUploadResult>;

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
  /** Native only: uploads a `file` source from disk. Without it a `file` source is refused. */
  uploadFromFile?: FileUploader | null;
}

/** A native upload's answer as a Response, so it goes through the same checks as fetch's. */
function uploadResponse(result: FileUploadResult): Response {
  const empty = result.status === 204 || result.status === 304;
  return new Response(empty ? null : result.body, {
    status: result.status,
    headers: result.headers,
  });
}

export type Jarvis3Api = ReturnType<typeof createJarvis3Api>;

/** The fetch body of a request: an upload's Blob or bytes, or JSON (a `file` upload has none). */
function requestPayload(body: unknown, upload: UploadBody | undefined): RequestInit | null {
  if (upload?.source.kind === "blob") return { body: upload.source.blob };
  if (upload?.source.kind === "bytes")
    return { body: upload.source.bytes as Uint8Array<ArrayBuffer> };
  if (upload) return null;
  if (body !== undefined) return { body: JSON.stringify(body) };
  return null;
}

export function createJarvis3Api(deps: Jarvis3ApiDeps) {
  /** Sends the request: a `file` upload through the native uploader, everything else by fetch. */
  async function send(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: unknown,
    upload: UploadBody | undefined,
  ): Promise<Response> {
    if (upload?.source.kind === "file") {
      if (!deps.uploadFromFile) {
        throw new Jarvis3Error("This device can't upload files from disk.", 0, "network");
      }
      return uploadResponse(await deps.uploadFromFile(url, upload.source.uri, headers));
    }
    return deps.fetch(url, {
      method,
      headers,
      credentials: deps.credentials,
      ...requestPayload(body, upload),
    });
  }

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
    if (upload?.source.kind === "file" && !deps.uploadFromFile) {
      throw new Jarvis3Error("This device can't upload files from disk.", 0, "network");
    }
    let response: Response;
    try {
      response = await send(base + path, method, headers, body, upload);
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

    // Push notifications (docs/API.md section 16): the caller's own settings and subscriptions.
    pushSettings: () => call<PushSettings>("GET", "/api/push"),
    setPushKinds: (kinds: SetPushKindsRequest["kinds"]) =>
      call<PushSettings>("PUT", "/api/push/kinds", { kinds } satisfies SetPushKindsRequest),
    subscribePush: (request: CreatePushSubscriptionRequest) =>
      call<PushSubscriptionView>("POST", "/api/push/subscriptions", request),
    unsubscribePush: (subscriptionId: string) =>
      call<{ ok: true }>("DELETE", `/api/push/subscriptions/${id(subscriptionId)}`),
    testPush: () => call<PushTestResult>("POST", "/api/push/test"),

    listTasks: () => call<TaskList>("GET", "/api/tasks"),
    getTask: (taskId: string) => call<TaskView>("GET", `/api/tasks/${id(taskId)}`),
    createTask: (request: CreateTaskRequest) => call<TaskView>("POST", "/api/tasks", request),
    pauseTask: (taskId: string) => call<TaskView>("POST", `/api/tasks/${id(taskId)}/pause`),
    resumeTask: (taskId: string) => call<TaskView>("POST", `/api/tasks/${id(taskId)}/resume`),
    deleteTask: (taskId: string) => call<TaskView>("DELETE", `/api/tasks/${id(taskId)}`),
    renameTask: (taskId: string, request: UpdateTaskRequest) =>
      call<TaskView>("PATCH", `/api/tasks/${id(taskId)}`, request),
    sendMessage: (taskId: string, request: SendMessageRequest) =>
      call<SendMessageResult>("POST", `/api/tasks/${id(taskId)}/messages`, request),

    listProjects: () => call<ProjectList>("GET", "/api/projects"),
    getProject: (projectId: string) => call<ProjectView>("GET", `/api/projects/${id(projectId)}`),
    createProject: (request: CreateProjectRequest) =>
      call<ProjectView>("POST", "/api/projects", request),
    updateProject: (projectId: string, request: UpdateProjectRequest) =>
      call<ProjectView>("PATCH", `/api/projects/${id(projectId)}`, request),
    deleteProject: (projectId: string) =>
      call<{ ok: true }>("DELETE", `/api/projects/${id(projectId)}`),

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
    /** The owner wakes their task once at a time (POST /api/tasks/:id/wakeups). */
    armWakeup: (taskId: string, request: ArmWakeupRequest) =>
      call<WakeupView>("POST", `/api/tasks/${id(taskId)}/wakeups`, request),
    /** The caller's channels, or (an admin) another user's. */
    listChannels: (userId?: string) =>
      call<ChannelList>("GET", userId ? `/api/channels?userId=${id(userId)}` : "/api/channels"),
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
    /** Creates or replaces the file at `path` with the upload's content (streamed when it can be). */
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
