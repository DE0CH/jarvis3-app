// iOS: PUT a file from disk with the platform's uploader (an upload task reading the file), so a
// large file is streamed and never read into JS memory.
import { FileSystemUploadType, uploadAsync } from "expo-file-system/legacy";
import type { FileUploader } from "./api";

export const nativeFileUploader: FileUploader = async (url, uri, headers) => {
  const result = await uploadAsync(url, uri, {
    httpMethod: "PUT",
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers,
  });
  return { status: result.status, headers: result.headers, body: result.body };
};
