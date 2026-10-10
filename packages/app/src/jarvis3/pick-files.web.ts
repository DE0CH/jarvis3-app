// Picking files to upload, web: the picked File goes to fetch as the body, and the browser streams
// it from disk, so a large file is never read into memory (pick-files.ts is the native version).
import { getMimeTypeFromPath } from "@/attachments/file-types";
import type { PickedFile } from "./files-store";

export function pickedFromWebFile(file: File): PickedFile {
  return {
    fileName: file.name,
    mimeType: file.type || getMimeTypeFromPath(file.name),
    size: file.size,
    source: async () => ({ kind: "blob", blob: file }),
  };
}

export function pickFilesToUpload(): Promise<PickedFile[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      resolve(files.length ? files.map(pickedFromWebFile) : null);
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}
