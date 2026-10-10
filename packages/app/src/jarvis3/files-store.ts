// State for the Files screen and for first-prompt attachments, with the API injected
// (files.test.ts). One store per screen: the Files screen of `me` or, for an admin, of another
// user.
import { type Jarvis3Api, type UploadSource, uploadSize } from "./api";
import type { FileList } from "./api-types";
import { attachmentPaths, joinPath, safeFileName, uploadSizeError } from "./files";
import { messageOf } from "./stores";

/** A file picked on the device (pick-files.ts). */
export interface PickedFile {
  fileName: string;
  mimeType: string;
  /** Size if known when picked; otherwise checked once the source is open. */
  size?: number;
  /** What to upload: the file itself (streamed), not its bytes read into memory. */
  source: () => Promise<UploadSource>;
}

export type UploadState = "waiting" | "uploading" | "done" | "failed";

export interface UploadItem {
  name: string;
  path: string;
  state: UploadState;
  error: string | null;
}

export interface FilesState {
  loaded: boolean;
  list: FileList | null;
  error: string | null;
  /** Uploads started from this screen, in pick order. */
  uploads: UploadItem[];
  /** A path with a delete or move in flight. */
  busyPath: string | null;
}

type FilesApi = Pick<Jarvis3Api, "listFiles" | "uploadFile" | "deleteFile" | "moveFile">;

/** Uploads picked files one after the other; `onChange` sees every state change. */
export async function uploadPicked(
  api: Pick<Jarvis3Api, "uploadFile">,
  items: UploadItem[],
  picked: readonly PickedFile[],
  list: FileList | null,
  userId: string,
  onChange: (items: UploadItem[]) => void,
): Promise<UploadItem[]> {
  let current = items.map((item) => ({ ...item }));
  const set = (index: number, patch: Partial<UploadItem>) => {
    current = current.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange(current);
  };
  let used = list?.usedBytes ?? 0;
  for (let i = 0; i < picked.length; i++) {
    const file = picked[i];
    const item = current[i];
    if (!file || !item || item.state === "done") continue;
    set(i, { state: "uploading", error: null });
    try {
      const early = file.size === undefined ? null : sizeCheck(list, used, item, file.size);
      if (early) throw new Error(early);
      const source = await file.source();
      const size = uploadSize(source);
      const late = sizeCheck(list, used, item, size);
      if (late) throw new Error(late);
      await api.uploadFile(
        item.path,
        { source, contentType: file.mimeType || "application/octet-stream" },
        userId,
      );
      used += size;
      set(i, { state: "done" });
    } catch (e) {
      set(i, { state: "failed", error: messageOf(e) });
    }
  }
  return current;
}

function sizeCheck(list: FileList | null, used: number, item: UploadItem, size: number) {
  const replacing = list?.files.find((f) => f.path === item.path)?.size ?? 0;
  return uploadSizeError(list ? { ...list, usedBytes: used } : null, item.name, size, replacing);
}

/** The upload plan for New task: each picked file under attachments/<requestId>/. */
export function attachmentItems(requestId: string, picked: readonly PickedFile[]): UploadItem[] {
  const paths = attachmentPaths(
    requestId,
    picked.map((file) => file.fileName),
  );
  return picked.map((file, i) => ({
    name: safeFileName(file.fileName),
    path: paths[i] ?? "",
    state: "waiting",
    error: null,
  }));
}

export function createFilesStore(api: FilesApi, userId = "me") {
  let state: FilesState = { loaded: false, list: null, error: null, uploads: [], busyPath: null };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<FilesState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  async function refresh(): Promise<void> {
    try {
      set({ list: await api.listFiles(userId), loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: messageOf(e) });
    }
  }

  return {
    get: (): FilesState => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    /** Uploads picked files into `dir` (a file of the same name is replaced). */
    async upload(dir: string, picked: readonly PickedFile[]): Promise<void> {
      const items: UploadItem[] = picked.map((file) => {
        const name = safeFileName(file.fileName);
        return { name, path: joinPath(dir, name), state: "waiting", error: null };
      });
      set({ uploads: items, error: null });
      await uploadPicked(api, items, picked, state.list, userId, (uploads) => set({ uploads }));
      await refresh();
    },
    clearUploads: () => set({ uploads: [] }),
    async remove(path: string): Promise<boolean> {
      set({ busyPath: path, error: null });
      try {
        await api.deleteFile(path, userId);
        await refresh();
        return true;
      } catch (e) {
        set({ error: messageOf(e) });
        return false;
      } finally {
        set({ busyPath: null });
      }
    },
    async move(from: string, to: string): Promise<string | null> {
      set({ busyPath: from, error: null });
      try {
        await api.moveFile(from, to, userId);
        await refresh();
        return null;
      } catch (e) {
        return messageOf(e);
      } finally {
        set({ busyPath: null });
      }
    },
  };
}

export type FilesStore = ReturnType<typeof createFilesStore>;
