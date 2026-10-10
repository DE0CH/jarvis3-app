// The web has no native file uploader: picked files are Blobs that fetch streams itself.
import type { FileUploader } from "./api";

export const nativeFileUploader: FileUploader | null = null;
