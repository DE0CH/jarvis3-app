// Projects: one or more git repos plus named secrets, picked per chat in the composer. The form's
// logic (draft <-> request, checks) and the list store; tested in projects.test.ts. Secret values
// are write-only: the server never sends one back, so a draft holds only what the user typed.
import type { Jarvis3Api } from "./api";
import type {
  CreateProjectRequest,
  ProjectRepoInput,
  ProjectView,
  UpdateProjectRequest,
} from "./api-types";
import { countOf } from "./count";
import { messageOf, type Store } from "./stores";

export const PROJECTS_MAX_PER_CHAT = 10;
export const REPOS_MAX = 10;
export const SECRETS_MAX = 50;
export const SECRET_KEY = /^[A-Z_][A-Z0-9_]{0,63}$/;
const RESERVED_PREFIXES = ["JARVIS_", "PASEO_", "OPENROUTER_", "OPENCODE_", "CF_ACCESS_"];
const RESERVED = new Set(["HOME", "USER", "LOGNAME", "PATH", "SHELL", "LANG", "TZ", "PWD"]);
const REF = /^[A-Za-z0-9._/-]{1,200}$/;

export interface RepoDraft {
  url: string;
  ref: string;
  /** A secret's key, or "" for a public repo. */
  tokenSecret: string;
}

export interface SecretDraft {
  key: string;
  /** What the user typed; "" keeps the stored value of an existing secret. */
  value: string;
  /** Stored on the server already (its value is never shown). */
  stored: boolean;
  /** Remove it on save. */
  removed: boolean;
}

export interface ProjectDraft {
  name: string;
  description: string;
  shared: boolean;
  roles: string[];
  repos: RepoDraft[];
  secrets: SecretDraft[];
}

export function emptyDraft(): ProjectDraft {
  return { name: "", description: "", shared: false, roles: [], repos: [], secrets: [] };
}

export function draftFromProject(project: ProjectView): ProjectDraft {
  return {
    name: project.name,
    description: project.description,
    shared: project.shared,
    roles: [...project.roles],
    repos: project.repos.map((repo) => ({
      url: repo.url,
      ref: repo.ref ?? "",
      tokenSecret: repo.tokenSecret ?? "",
    })),
    secrets: project.secrets.map((secret) => ({
      key: secret.key,
      value: "",
      stored: true,
      removed: false,
    })),
  };
}

export function isReservedKey(key: string): boolean {
  return RESERVED.has(key) || RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** The keys the Project will have after saving. */
export function keptKeys(draft: ProjectDraft): string[] {
  return draft.secrets
    .filter((secret) => !secret.removed && (secret.stored || secret.value !== ""))
    .map((secret) => secret.key.trim());
}

function checkHeader(draft: ProjectDraft): string | null {
  const name = draft.name.trim();
  if (!name) return "Give the Project a name.";
  if (name.length > 80) return "The name is limited to 80 characters.";
  if (draft.description.length > 2000) return "The description is limited to 2,000 characters.";
  if (draft.shared && draft.roles.length === 0) {
    return "Pick at least one role for a shared Project.";
  }
  if (draft.repos.length > REPOS_MAX) return `A Project has at most ${REPOS_MAX} repos.`;
  return null;
}

function checkSecret(secret: SecretDraft, key: string, seen: ReadonlySet<string>): string | null {
  if (!SECRET_KEY.test(key)) {
    return `"${key || "(empty)"}" isn't a valid name: use capital letters, digits and _, starting with a letter or _.`;
  }
  if (isReservedKey(key)) return `${key} is set by Jarvis itself; pick another name.`;
  if (seen.has(key)) return `${key} is there twice.`;
  if (!secret.stored && secret.value === "") return `Enter a value for ${key}.`;
  if (secret.value.length > 16_384) return `The value of ${key} is too long (16 KB at most).`;
  return null;
}

function checkRepo(repo: RepoDraft, keys: ReadonlySet<string>): string | null {
  const url = repo.url.trim();
  if (!/^https:\/\/[^\s/@]+\/\S+$/.test(url)) {
    return `"${url || "(empty)"}" isn't an https address of a repo (like https://github.com/org/repo.git, with no password in it).`;
  }
  if (repo.ref.trim() && !REF.test(repo.ref.trim())) {
    return `"${repo.ref}" isn't a branch or tag name.`;
  }
  if (repo.tokenSecret && !keys.has(repo.tokenSecret)) {
    return `The token for ${url} names ${repo.tokenSecret}, which isn't one of this Project's secrets.`;
  }
  return null;
}

/** The first thing wrong with the draft, in words, or null. */
export function checkDraft(draft: ProjectDraft): string | null {
  const header = checkHeader(draft);
  if (header) return header;
  const keys = new Set<string>();
  for (const secret of draft.secrets) {
    if (secret.removed) continue;
    const key = secret.key.trim();
    const problem = checkSecret(secret, key, keys);
    if (problem) return problem;
    keys.add(key);
  }
  if (keys.size > SECRETS_MAX) return `A Project has at most ${SECRETS_MAX} secrets.`;
  for (const repo of draft.repos) {
    const problem = checkRepo(repo, keys);
    if (problem) return problem;
  }
  return null;
}

function repoInputs(draft: ProjectDraft): ProjectRepoInput[] {
  return draft.repos.map((repo) => ({
    url: repo.url.trim(),
    ref: repo.ref.trim() || null,
    tokenSecret: repo.tokenSecret || null,
  }));
}

export function createRequest(draft: ProjectDraft): CreateProjectRequest {
  const secrets: Record<string, string> = {};
  for (const secret of draft.secrets) {
    if (!secret.removed && secret.value !== "") secrets[secret.key.trim()] = secret.value;
  }
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    repos: repoInputs(draft),
    secrets,
    ...(draft.shared ? { shared: true, roles: draft.roles } : {}),
  };
}

/** Only what changed; a typed value sets a secret, a removed stored one is deleted (null). */
export function updateRequest(draft: ProjectDraft, original: ProjectView): UpdateProjectRequest {
  const request: UpdateProjectRequest = {};
  if (draft.name.trim() !== original.name) request.name = draft.name.trim();
  if (draft.description.trim() !== original.description) {
    request.description = draft.description.trim();
  }
  const repos = repoInputs(draft);
  const before = original.repos.map((repo) => ({
    url: repo.url,
    ref: repo.ref,
    tokenSecret: repo.tokenSecret,
  }));
  if (JSON.stringify(repos) !== JSON.stringify(before)) request.repos = repos;
  const secrets: Record<string, string | null> = {};
  for (const secret of draft.secrets) {
    const key = secret.key.trim();
    if (secret.removed) {
      if (secret.stored) secrets[key] = null;
    } else if (secret.value !== "") secrets[key] = secret.value;
  }
  if (Object.keys(secrets).length) request.secrets = secrets;
  if (original.shared && JSON.stringify(draft.roles) !== JSON.stringify(original.roles)) {
    request.roles = draft.roles;
  }
  return request;
}

/** "2 repos · 3 secrets · Shared with staff" for a list row. */
export function projectSummary(project: ProjectView): string {
  const parts = [countOf(project.repos.length, "repo"), countOf(project.secrets.length, "secret")];
  if (project.shared) parts.push(`Shared with ${project.roles.join(", ") || "nobody"}`);
  return parts.join(" · ");
}

/** The repo's folder name in the chat's workspace, as the session names it. */
export function repoFolder(url: string): string {
  const last = url.replace(/\/+$/, "").split("/").pop() ?? "repo";
  return last.replace(/\.git$/, "") || "repo";
}

export function toggleProject(current: readonly string[], id: string): string[] {
  if (current.includes(id)) return current.filter((x) => x !== id);
  if (current.length >= PROJECTS_MAX_PER_CHAT) return [...current];
  return [...current, id];
}

// ---- the list --------------------------------------------------------------------------------

export interface ProjectsState {
  loaded: boolean;
  projects: ProjectView[];
  /** The instance's roles (admins only), for a shared Project's form. */
  roles: string[];
  error: string | null;
}

export function createProjectsStore(api: Jarvis3Api): Store<ProjectsState> & {
  load(): Promise<void>;
  put(project: ProjectView): void;
  drop(projectId: string): void;
} {
  let state: ProjectsState = { loaded: false, projects: [], roles: [], error: null };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ProjectsState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  let inflight: Promise<void> | null = null;
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load() {
      inflight ??= (async () => {
        try {
          const list = await api.listProjects();
          set({ loaded: true, projects: list.projects, roles: list.roles ?? [], error: null });
        } catch (error) {
          set({ loaded: true, error: messageOf(error) });
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    },
    put(project) {
      const rest = state.projects.filter((p) => p.id !== project.id);
      set({ projects: [...rest, project].sort((a, b) => a.name.localeCompare(b.name)) });
    },
    drop(projectId) {
      set({ projects: state.projects.filter((p) => p.id !== projectId) });
    },
  };
}
