import { describe, expect, it, vi } from "vitest";
import { createJarvis3Api, type UploadBody } from "./api";
import type { FileList, FileView } from "./api-types";
import {
  attachmentList,
  attachmentPaths,
  breadcrumbs,
  chooserFiles,
  encodeFilePath,
  filePathError,
  folderExists,
  formatBytes,
  listFolder,
  planMove,
  safeFileName,
  toggleChosen,
  uploadSizeError,
} from "./files";
import { attachmentItems, createFilesStore, type PickedFile, uploadPicked } from "./files-store";
import { Jarvis3Error } from "./plan";

function file(path: string, size = 10, patch: Partial<FileView> = {}): FileView {
  return {
    path,
    size,
    contentType: "text/plain",
    updatedAt: "2026-10-10T10:00:00.000Z",
    source: "user",
    taskId: null,
    ...patch,
  };
}

const statesOf = (items: { state: string }[]) => items.map((i) => i.state);
const withoutPath = (files: FileView[], path: string) => files.filter((f) => f.path !== path);
const renamed = (files: FileView[], from: string, to: string) =>
  files.map((f) => (f.path === from ? file(to) : f));

function fileList(files: FileView[], patch: Partial<FileList> = {}): FileList {
  return {
    files,
    usedBytes: files.reduce((sum, f) => sum + f.size, 0),
    quotaBytes: 1000,
    maxFileBytes: 100,
    ...patch,
  };
}

function picked(name: string, bytes = 5, mimeType = "text/plain"): PickedFile {
  return {
    fileName: name,
    mimeType,
    source: async () => ({ kind: "bytes", bytes: new Uint8Array(bytes) }),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiWith(fetch: ReturnType<typeof vi.fn>) {
  return createJarvis3Api({
    baseUrl: () => "https://i.example.org",
    authHeaders: () => null,
    credentials: "include",
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
}

describe("file paths", () => {
  it("accepts nested names and refuses what the server refuses", () => {
    expect(filePathError("reports/q3 summary.pdf")).toBeNull();
    expect(filePathError("")).toMatch(/name/);
    expect(filePathError("/abs")).toMatch(/start or end/);
    expect(filePathError("a//b")).toMatch(/\/\//);
    expect(filePathError("a/../b")).toMatch(/“\.\.”/);
    expect(filePathError("a\\b")).toMatch(/backslash/);
    expect(filePathError("a\u0001b")).toMatch(/control/);
    expect(filePathError("x".repeat(513))).toMatch(/512/);
    expect(filePathError(`a/${"y".repeat(256)}`)).toMatch(/255/);
  });

  it("makes a picked file's name one safe segment", () => {
    expect(safeFileName("C:\\Users\\me\\scan.pdf")).toBe("scan.pdf");
    expect(safeFileName("dir/photo.jpg")).toBe("photo.jpg");
    expect(safeFileName("..")).toBe("file");
    expect(safeFileName("  ")).toBe("file");
    expect(safeFileName("a\u0007b.txt")).toBe("ab.txt");
  });

  it("encodes each segment and keeps the separators", () => {
    expect(encodeFilePath("my docs/q3 #1.pdf")).toBe("my%20docs/q3%20%231.pdf");
  });
});

describe("listFolder", () => {
  const files = [
    file("b.txt"),
    file("A.txt"),
    file("reports/q3.pdf", 40, { updatedAt: "2026-10-11T00:00:00.000Z" }),
    file("reports/2025/q4.pdf", 50),
    file("attachments/r1/photo.jpg", 7),
  ];

  it("shows the root's folders (implied by paths) and its own files, by name", () => {
    const root = listFolder(files, "");
    expect(root.folders.map((f) => [f.name, f.count, f.size])).toEqual([
      ["attachments", 1, 7],
      ["reports", 2, 90],
    ]);
    expect(root.folders[1]?.updatedAt).toBe("2026-10-11T00:00:00.000Z");
    expect(root.files.map((f) => f.path)).toEqual(["A.txt", "b.txt"]);
  });

  it("shows a subfolder", () => {
    const reports = listFolder(files, "reports");
    expect(reports.folders.map((f) => f.path)).toEqual(["reports/2025"]);
    expect(reports.files.map((f) => f.path)).toEqual(["reports/q3.pdf"]);
  });

  it("knows when a folder is gone", () => {
    expect(folderExists(files, "reports/2025")).toBe(true);
    expect(folderExists(files, "report")).toBe(false);
    expect(folderExists([], "")).toBe(true);
  });

  it("builds breadcrumbs", () => {
    expect(breadcrumbs("")).toEqual([{ label: "Files", dir: "" }]);
    expect(breadcrumbs("a/b")).toEqual([
      { label: "Files", dir: "" },
      { label: "a", dir: "a" },
      { label: "b", dir: "a/b" },
    ]);
  });
});

describe("sizes and moves", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });

  it("checks the per-file limit and the quota before uploading", () => {
    const list = fileList([file("a", 950)]);
    expect(uploadSizeError(list, "big.bin", 101)).toMatch(/limited to 100 B/);
    expect(uploadSizeError(list, "c.txt", 60)).toMatch(/doesn't fit/);
    expect(uploadSizeError(list, "a", 95, 950)).toBeNull(); // replacing frees its old size
    expect(uploadSizeError(null, "x", 10 ** 12)).toBeNull();
  });

  it("plans a rename or move", () => {
    const files = [file("a.txt"), file("b.txt"), file("dir/c.txt")];
    expect(planMove(files, "a.txt", " reports/a.txt ")).toEqual({ ok: true, to: "reports/a.txt" });
    expect(planMove(files, "a.txt", "b.txt")).toMatchObject({ ok: false, error: /exists/ });
    expect(planMove(files, "a.txt", "dir")).toMatchObject({ ok: false, error: /folder/ });
    expect(planMove(files, "a.txt", "a.txt")).toMatchObject({ ok: false });
    expect(planMove(files, "a.txt", "x/../y")).toMatchObject({ ok: false });
  });
});

describe("attachments", () => {
  it("puts each picked file under attachments/<requestId>/ with unique names", () => {
    expect(attachmentPaths("r1", ["scan.pdf", "Scan.pdf", "scan.pdf", "notes", "a/b.txt"])).toEqual(
      [
        "attachments/r1/scan.pdf",
        "attachments/r1/Scan (2).pdf",
        "attachments/r1/scan (3).pdf",
        "attachments/r1/notes",
        "attachments/r1/b.txt",
      ],
    );
  });

  it("uploads one after the other, skips what is done and reports failures", async () => {
    const uploadFile = vi.fn(async (path: string) => {
      if (path.endsWith("bad.txt")) throw new Jarvis3Error("Too large.", 413, "too_large");
      return file(path);
    });
    const files = [picked("ok.txt"), picked("bad.txt"), picked("done.txt")];
    const items = attachmentItems("r1", files);
    items[2] = { ...items[2]!, state: "done" };
    const seen: string[][] = [];
    const result = await uploadPicked({ uploadFile }, items, files, null, "me", (now) =>
      seen.push(statesOf(now)),
    );
    expect(result.map((i) => i.state)).toEqual(["done", "failed", "done"]);
    expect(result[1]?.error).toBe("Too large.");
    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(uploadFile.mock.calls[0]?.[0]).toBe("attachments/r1/ok.txt");
    expect(seen[0]).toEqual(["uploading", "waiting", "done"]);
  });

  it("refuses a file over the limit before reading it when its size is known", async () => {
    const source = vi.fn(async () => ({ kind: "bytes" as const, bytes: new Uint8Array(1) }));
    const huge: PickedFile = {
      fileName: "huge.mov",
      mimeType: "video/quicktime",
      size: 101,
      source,
    };
    const uploadFile = vi.fn();
    const result = await uploadPicked(
      { uploadFile },
      attachmentItems("r1", [huge]),
      [huge],
      fileList([]),
      "me",
      () => undefined,
    );
    expect(result[0]?.state).toBe("failed");
    expect(source).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });
});

describe("files API and store", () => {
  it("uploads the raw bytes with their type to the encoded path", async () => {
    const fetch = vi.fn(async () => jsonResponse(201, file("my docs/a b.txt")));
    await apiWith(fetch).uploadFile("my docs/a b.txt", {
      source: { kind: "bytes", bytes: new Uint8Array([1, 2, 3]) },
      contentType: "text/plain",
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://i.example.org/api/users/me/files/my%20docs/a%20b.txt");
    expect(init.method).toBe("PUT");
    expect(init.body).toEqual(new Uint8Array([1, 2, 3]));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("text/plain");
  });

  it("streams a web File: the Blob itself is the body, never read into memory", async () => {
    const fetch = vi.fn(async () => jsonResponse(201, file("big.mov")));
    const blob = new Blob([new Uint8Array(1000)], { type: "video/quicktime" });
    const arrayBuffer = vi.spyOn(blob, "arrayBuffer");
    await apiWith(fetch).uploadFile("big.mov", {
      source: { kind: "blob", blob },
      contentType: "video/quicktime",
    });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(blob);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("uploads a device file from disk through the native uploader, with the headers", async () => {
    const fetch = vi.fn();
    const uploadFromFile = vi.fn(async () => ({
      status: 201,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(file("scan.pdf")),
    }));
    const api = createJarvis3Api({
      baseUrl: () => "https://i.example.org",
      authHeaders: () => ({ "CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "s" }),
      credentials: "omit",
      fetch: fetch as unknown as typeof globalThis.fetch,
      uploadFromFile,
    });
    const view = await api.uploadFile("docs/scan.pdf", {
      source: { kind: "file", uri: "file:///cache/scan.pdf", size: 80_000_000 },
      contentType: "application/pdf",
    });
    expect(view.path).toBe("scan.pdf");
    expect(fetch).not.toHaveBeenCalled();
    expect(uploadFromFile).toHaveBeenCalledWith(
      "https://i.example.org/api/users/me/files/docs/scan.pdf",
      "file:///cache/scan.pdf",
      expect.objectContaining({
        "CF-Access-Client-Id": "id",
        "Content-Type": "application/pdf",
      }),
    );
    // its refusals read like fetch's
    uploadFromFile.mockResolvedValueOnce({
      status: 413,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: { code: "too_large", message: "over your quota" } }),
    });
    await expect(
      api.uploadFile("x.pdf", {
        source: { kind: "file", uri: "file:///x.pdf", size: 1 },
        contentType: "application/pdf",
      }),
    ).rejects.toMatchObject({ code: "too_large" });
    // without a native uploader (the web) a file source is refused, not read
    await expect(
      apiWith(vi.fn()).uploadFile("x.pdf", {
        source: { kind: "file", uri: "file:///x.pdf", size: 1 },
        contentType: "",
      }),
    ).rejects.toThrow(/can't upload files from disk/);
  });

  it("checks a streamed file's size from its source, before uploading", async () => {
    const uploadFile = vi.fn();
    const big: PickedFile = {
      fileName: "big.bin",
      mimeType: "",
      source: async () => ({ kind: "file", uri: "file:///big.bin", size: 101 }),
    };
    const [item] = await uploadPicked(
      { uploadFile },
      attachmentItems("r1", [big]),
      [big],
      fileList([]),
      "me",
      () => undefined,
    );
    expect(item?.state).toBe("failed");
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("asks for a download link, moves and deletes, for me or another user", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { url: "https://s3/x", expiresAt: "t" }));
    const api = apiWith(fetch);
    await api.fileLink("a/b.txt");
    await api.fileLink("a.txt", "u2");
    await api.moveFile("a.txt", "b.txt");
    await api.deleteFile("b.txt");
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(
      calls.map(([url, init]) => `${init.method} ${url.replace("https://i.example.org", "")}`),
    ).toEqual([
      "GET /api/users/me/files/a/b.txt?link=1",
      "GET /api/users/u2/files/a.txt?link=1",
      "POST /api/users/me/files/move",
      "DELETE /api/users/me/files/b.txt",
    ]);
    expect(JSON.parse(String(calls[2]?.[1].body))).toEqual({ from: "a.txt", to: "b.txt" });
  });

  it("shows the server's too_large message", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(413, { error: { code: "too_large", message: "over your 1 GiB quota" } }),
    );
    await expect(
      apiWith(fetch).uploadFile("a", {
        source: { kind: "bytes", bytes: new Uint8Array(1) },
        contentType: "",
      }),
    ).rejects.toMatchObject({ code: "too_large", message: "Over your 1 GiB quota" });
  });

  it("the store lists, uploads into the folder, moves and deletes", async () => {
    let files = [file("old.txt")];
    const api = {
      listFiles: vi.fn(async () => fileList(files)),
      uploadFile: vi.fn(async (path: string, _upload: UploadBody, _userId?: string) => {
        files = [...files, file(path)];
        return file(path);
      }),
      deleteFile: vi.fn(async (path: string) => {
        files = withoutPath(files, path);
        return { ok: true as const };
      }),
      moveFile: vi.fn(async (from: string, to: string) => {
        if (to === "taken") throw new Jarvis3Error("Taken exists.", 409, "conflict");
        files = renamed(files, from, to);
        return file(to);
      }),
    };
    const store = createFilesStore(api, "u2");
    await store.refresh();
    expect(store.get().list?.files).toHaveLength(1);
    await store.upload("docs", [picked("new.txt")]);
    expect(api.uploadFile.mock.calls[0]?.[0]).toBe("docs/new.txt");
    expect(api.uploadFile.mock.calls[0]?.[2]).toBe("u2");
    expect(store.get().uploads.map((u) => u.state)).toEqual(["done"]);
    expect(store.get().list?.files.map((f) => f.path)).toEqual(["old.txt", "docs/new.txt"]);
    expect(await store.move("old.txt", "taken")).toBe("Taken exists.");
    expect(await store.move("old.txt", "renamed.txt")).toBeNull();
    expect(await store.remove("renamed.txt")).toBe(true);
    expect(store.get().list?.files.map((f) => f.path)).toEqual(["docs/new.txt"]);
    expect(store.get().busyPath).toBeNull();
  });
});

describe("New task: attaching files already in Files", () => {
  const files = [
    file("reports/Q3.pdf", 10, { updatedAt: "2026-10-01T10:00:00.000Z" }),
    file("photos/site.jpg", 10, { updatedAt: "2026-10-09T10:00:00.000Z" }),
    file("notes.txt", 10, { updatedAt: "2026-10-05T10:00:00.000Z" }),
  ];

  it("lists them newest first and filters on any part of the path", () => {
    expect(chooserFiles(files, "").map((f) => f.path)).toEqual([
      "photos/site.jpg",
      "notes.txt",
      "reports/Q3.pdf",
    ]);
    expect(chooserFiles(files, " q3 ").map((f) => f.path)).toEqual(["reports/Q3.pdf"]);
    expect(chooserFiles(files, "REPORTS/").map((f) => f.path)).toEqual(["reports/Q3.pdf"]);
    expect(chooserFiles(files, "nothing")).toEqual([]);
  });

  it("toggles a choice and stops at the room left", () => {
    expect(toggleChosen([], "a", 2)).toEqual(["a"]);
    expect(toggleChosen(["a"], "b", 2)).toEqual(["a", "b"]);
    expect(toggleChosen(["a", "b"], "c", 2)).toEqual(["a", "b"]);
    expect(toggleChosen(["a", "b"], "a", 2)).toEqual(["b"]);
    expect(toggleChosen([], "a", 0)).toEqual([]);
  });

  it("sends uploads and chosen files together, each path once", () => {
    expect(attachmentList(["attachments/r1/x.txt"], ["notes.txt", "attachments/r1/x.txt"])).toEqual(
      ["attachments/r1/x.txt", "notes.txt"],
    );
  });
});
