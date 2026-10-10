// Picking files to upload, native (iOS): the document picker copies each file into the app's
// cache, and the upload streams it from there (upload-file.native.ts), so a large file never sits
// in JS memory. The web version is pick-files.web.ts. Paseo's own picker (use-file-picker) reads
// every file's bytes, which the chat's image attachments need but uploads don't.
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { getMimeTypeFromPath } from "@/attachments/file-types";
import type { PickedFile } from "./files-store";

export async function pickFilesToUpload(): Promise<PickedFile[] | null> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled || result.assets.length === 0) return null;
  return result.assets.map((asset) => {
    const size = asset.size ?? undefined;
    const picked: PickedFile = {
      fileName: asset.name,
      mimeType: asset.mimeType ?? getMimeTypeFromPath(asset.name),
      source: async () => ({
        kind: "file" as const,
        uri: asset.uri,
        size: size ?? new File(asset.uri).size,
      }),
    };
    if (size !== undefined) picked.size = size;
    return picked;
  });
}
