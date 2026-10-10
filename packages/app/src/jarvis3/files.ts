// The user's files (docs/API.md in DE0CH/jarvis3, "Files"): pure decisions for the Files screen
// and for first-prompt attachments. Paths are relative, "/"-separated; folders exist only as the
// prefixes of file paths. Unit-tested in files.test.ts.
import type { FileList, FileView } from "./api-types";

export const PATH_MAX = 512;
export const SEGMENT_MAX = 255;
/** At most this many files go with one first prompt (CreateTaskRequest.attachments). */
export const ATTACHMENTS_MAX = 20;
/** The folder New task uploads attachments into: attachments/<requestId>/<name>. */
export const ATTACHMENTS_DIR = "attachments";

function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 0x20) return true;
  return false;
}

/** Why `path` is not a valid file path, or null when it is (the server's rule). */
export function filePathError(path: string): string | null {
  if (!path) return "Give the file a name.";
  if (path.length > PATH_MAX) return `A path is limited to ${PATH_MAX} characters.`;
  if (path.includes("\\") || hasControlChar(path)) {
    return "Names can't contain backslashes or control characters.";
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (!segment) return "A path can't start or end with “/” or contain “//”.";
    if (segment === "." || segment === "..") return "“.” and “..” can't be used as names.";
    if (segment.length > SEGMENT_MAX) return `Each name is limited to ${SEGMENT_MAX} characters.`;
  }
  return null;
}

/** A picked file's name made safe as one path segment (no slashes, control characters). */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = [...base]
    .filter((ch) => !hasControlChar(ch))
    .join("")
    .trim()
    .slice(0, 200);
  if (!cleaned || cleaned === "." || cleaned === "..") return "file";
  return cleaned;
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function parentDir(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? "" : path.slice(0, at);
}

/** A path for the URL: each segment encoded, "/" kept as the separator. */
export function encodeFilePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export interface FolderEntry {
  name: string;
  path: string;
  /** Files anywhere under this folder, and their total size. */
  count: number;
  size: number;
  updatedAt: string;
}

export interface FolderListing {
  folders: FolderEntry[];
  files: FileView[];
}

/** What one folder shows: its subfolders (implied by deeper paths) and its own files, by name. */
export function listFolder(files: readonly FileView[], dir: string): FolderListing {
  const prefix = dir ? `${dir}/` : "";
  const folders = new Map<string, FolderEntry>();
  const own: FileView[] = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      own.push(file);
      continue;
    }
    const name = rest.slice(0, slash);
    const entry = folders.get(name) ?? {
      name,
      path: prefix + name,
      count: 0,
      size: 0,
      updatedAt: file.updatedAt,
    };
    entry.count += 1;
    entry.size += file.size;
    if (file.updatedAt > entry.updatedAt) entry.updatedAt = file.updatedAt;
    folders.set(name, entry);
  }
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  return {
    folders: [...folders.values()].toSorted(byName),
    files: own
      .map((file) => ({ file, name: baseName(file.path) }))
      .toSorted(byName)
      .map((entry) => entry.file),
  };
}

/** Whether `dir` still has anything in it (a folder disappears with its last file). */
export function folderExists(files: readonly FileView[], dir: string): boolean {
  return !dir || files.some((file) => file.path.startsWith(`${dir}/`));
}

export interface Crumb {
  label: string;
  dir: string;
}

export function breadcrumbs(dir: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: "Files", dir: "" }];
  if (!dir) return crumbs;
  let at = "";
  for (const segment of dir.split("/")) {
    at = joinPath(at, segment);
    crumbs.push({ label: segment, dir: at });
  }
  return crumbs;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function usageLine(list: Pick<FileList, "usedBytes" | "quotaBytes">): string {
  return `${formatBytes(list.usedBytes)} of ${formatBytes(list.quotaBytes)} used`;
}

/**
 * Why a file of `size` bytes can't be uploaded (replacing `replacing` bytes at the same path),
 * or null. The server checks the same; this only saves a doomed upload.
 */
export function uploadSizeError(
  list: Pick<FileList, "usedBytes" | "quotaBytes" | "maxFileBytes"> | null,
  name: string,
  size: number,
  replacing = 0,
): string | null {
  if (!list) return null;
  if (size > list.maxFileBytes) {
    return `${name} is ${formatBytes(size)}; files are limited to ${formatBytes(list.maxFileBytes)}.`;
  }
  if (list.usedBytes - replacing + size > list.quotaBytes) {
    return `${name} doesn't fit: ${usageLine(list)}.`;
  }
  return null;
}

/**
 * Paths for first-prompt attachments: attachments/<requestId>/<name>, with " (2)", " (3)"… before
 * the extension when two picked files share a name.
 */
export function attachmentPaths(requestId: string, names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((raw) => {
    const name = safeFileName(raw);
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    taken.add(candidate.toLowerCase());
    return joinPath(joinPath(ATTACHMENTS_DIR, requestId), candidate);
  });
}

/** Where a rename/move of `from` to the typed `to` goes, or why it can't. */
export function planMove(
  files: readonly FileView[],
  from: string,
  to: string,
): { ok: true; to: string } | { ok: false; error: string } {
  const target = to.trim().replace(/^\/+|\/+$/g, "");
  const invalid = filePathError(target);
  if (invalid) return { ok: false, error: invalid };
  if (target === from) return { ok: false, error: "That is the file's current name." };
  if (files.some((file) => file.path === target)) {
    return { ok: false, error: `${target} already exists.` };
  }
  if (files.some((file) => file.path.startsWith(`${target}/`))) {
    return { ok: false, error: `${target} is a folder.` };
  }
  return { ok: true, to: target };
}

export function fileSourceLabel(file: Pick<FileView, "source" | "taskId">): string | null {
  return file.source === "session" ? "Saved by a task" : null;
}
