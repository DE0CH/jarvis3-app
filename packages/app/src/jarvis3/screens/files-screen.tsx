// Files: the user's own files (docs/API.md in DE0CH/jarvis3, "Files"), which every new task of
// theirs finds in ~/files. Folders are implied by paths. Upload, download, rename/move, delete
// (a centered confirmation). An admin can open another person's files with ?user=<id>.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsInput } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { useFilePicker } from "@/hooks/use-file-picker";
import { openExternalUrl } from "@/utils/open-external-url";
import type { FileView } from "../api-types";
import { jarvis3Api } from "../client";
import {
  baseName,
  breadcrumbs,
  fileSourceLabel,
  folderExists,
  formatBytes,
  listFolder,
  planMove,
  usageLine,
  type FolderEntry,
} from "../files";
import { createFilesStore, type FilesStore, type UploadItem } from "../files-store";
import { useAccount } from "../hooks";
import { messageOf } from "../stores";
import { Banner, CenteredDialog, EmptyState, Jarvis3Frame } from "../ui";
import { formatWhen } from "./format";

function useFilesStore(userId: string): FilesStore {
  return useMemo(() => createFilesStore(jarvis3Api, userId), [userId]);
}

export function FilesScreen({ dir, userId }: { dir: string; userId: string | null }) {
  const router = useRouter();
  const account = useAccount();
  const owner = userId ?? "me";
  const store = useFilesStore(owner);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const { pickFiles } = useFilePicker();
  const [deleting, setDeleting] = useState<FileView | null>(null);
  const [moving, setMoving] = useState<FileView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const readOnly = userId !== null && userId !== account.me?.user.id;

  useEffect(() => {
    void store.refresh();
  }, [store]);

  const files = state.list?.files;
  const listing = useMemo(() => listFolder(files ?? [], dir), [files, dir]);

  const go = useCallback(
    (next: string) => {
      const params = new URLSearchParams();
      if (next) params.set("dir", next);
      if (userId) params.set("user", userId);
      const query = params.toString();
      router.replace(`/files${query ? `?${query}` : ""}` as Href);
    },
    [router, userId],
  );

  // A folder whose last file went away (deleted or moved) disappears: go up to what exists.
  useEffect(() => {
    if (!files || folderExists(files, dir)) return;
    let up = dir;
    while (up && !folderExists(files, up))
      up = up.includes("/") ? up.slice(0, up.lastIndexOf("/")) : "";
    go(up);
  }, [files, dir, go]);

  const upload = useCallback(() => {
    const run = async () => {
      setNotice(null);
      try {
        const picked = await pickFiles();
        if (picked?.length) await store.upload(dir, picked);
      } catch (e) {
        setNotice(messageOf(e));
      }
    };
    void run();
  }, [pickFiles, store, dir]);

  const download = useCallback(
    (file: FileView) => {
      const run = async () => {
        try {
          await openExternalUrl((await jarvis3Api.fileLink(file.path, owner)).url);
        } catch (e) {
          setNotice(messageOf(e));
        }
      };
      void run();
    },
    [owner],
  );

  const confirmDelete = useCallback(() => {
    const target = deleting;
    setDeleting(null);
    if (target) void store.remove(target.path);
  }, [deleting, store]);
  const cancelDelete = useCallback(() => setDeleting(null), []);
  const closeMove = useCallback(() => setMoving(null), []);

  const actions = useMemo(
    () =>
      readOnly ? null : (
        <Button variant="default" size="sm" onPress={upload} testID="jarvis3-files-upload">
          Upload
        </Button>
      ),
    [readOnly, upload],
  );

  return (
    <Jarvis3Frame
      title={readOnly ? "Files (read only)" : "Files"}
      actions={actions}
      testID="jarvis3-files-screen"
    >
      <Breadcrumbs dir={dir} onGo={go} />
      {state.list ? (
        <Text style={styles.hint} testID="jarvis3-files-usage">
          {`${usageLine(state.list)} · up to ${formatBytes(state.list.maxFileBytes)} per file. New tasks find these files in ~/files.`}
        </Text>
      ) : null}
      {state.error ? (
        <Banner tone="error" testID="jarvis3-files-error">
          {state.error}
        </Banner>
      ) : null}
      {notice ? <Banner tone="error">{notice}</Banner> : null}
      <Uploads items={state.uploads} onDismiss={store.clearUploads} />
      {moving ? (
        <MoveEditor
          key={moving.path}
          file={moving}
          files={files ?? []}
          store={store}
          onDone={closeMove}
        />
      ) : null}
      <FolderBody
        loaded={state.loaded}
        listing={listing}
        busyPath={state.busyPath}
        readOnly={readOnly}
        onOpenFolder={go}
        onDownload={download}
        onDelete={setDeleting}
        onMove={setMoving}
      />
      <CenteredDialog
        visible={deleting !== null}
        title="Delete this file?"
        message={`"${deleting?.path ?? ""}" is deleted. Tasks that are running keep their own copy.`}
        confirmLabel="Delete"
        destructive
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
        testID="jarvis3-file-delete-dialog"
      />
    </Jarvis3Frame>
  );
}

function Breadcrumbs({ dir, onGo }: { dir: string; onGo: (dir: string) => void }) {
  const crumbs = breadcrumbs(dir);
  if (crumbs.length === 1) return null;
  return (
    <View style={styles.crumbs} testID="jarvis3-files-crumbs">
      {crumbs.map((crumb, i) => (
        <Crumb
          key={crumb.dir}
          label={crumb.label}
          dir={crumb.dir}
          last={i === crumbs.length - 1}
          onGo={onGo}
        />
      ))}
    </View>
  );
}

function Crumb({
  label,
  dir,
  last,
  onGo,
}: {
  label: string;
  dir: string;
  last: boolean;
  onGo: (dir: string) => void;
}) {
  const press = useCallback(() => onGo(dir), [onGo, dir]);
  return (
    <View style={styles.crumbItem}>
      <Pressable onPress={last ? undefined : press} disabled={last} accessibilityRole="link">
        <Text style={last ? styles.crumbCurrent : styles.crumbLink}>{label}</Text>
      </Pressable>
      {last ? null : <Text style={styles.hint}>/</Text>}
    </View>
  );
}

function Uploads({ items, onDismiss }: { items: UploadItem[]; onDismiss: () => void }) {
  if (items.length === 0) return null;
  const running = items.some((item) => item.state === "waiting" || item.state === "uploading");
  const failed = items.filter((item) => item.state === "failed");
  return (
    <SettingsCard testID="jarvis3-files-uploads">
      {items.map((item) => (
        <View key={item.path} style={styles.uploadRow}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={item.state === "failed" ? styles.error : styles.hint}>
            {uploadLabel(item)}
          </Text>
        </View>
      ))}
      {running ? null : (
        <View style={styles.uploadRow}>
          <Text style={styles.hint}>
            {failed.length
              ? `${failed.length} upload${failed.length === 1 ? "" : "s"} failed.`
              : "Uploaded."}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            onPress={onDismiss}
            testID="jarvis3-files-uploads-dismiss"
          >
            Dismiss
          </Button>
        </View>
      )}
    </SettingsCard>
  );
}

export function uploadLabel(item: UploadItem): string {
  if (item.state === "waiting") return "Waiting…";
  if (item.state === "uploading") return "Uploading…";
  if (item.state === "done") return "Uploaded";
  return item.error ?? "Failed";
}

function FolderBody({
  loaded,
  listing,
  busyPath,
  readOnly,
  onOpenFolder,
  onDownload,
  onDelete,
  onMove,
}: {
  loaded: boolean;
  listing: ReturnType<typeof listFolder>;
  busyPath: string | null;
  readOnly: boolean;
  onOpenFolder: (dir: string) => void;
  onDownload: (file: FileView) => void;
  onDelete: (file: FileView) => void;
  onMove: (file: FileView) => void;
}) {
  if (!loaded) return <EmptyState title="Loading…" />;
  if (listing.folders.length === 0 && listing.files.length === 0) {
    return (
      <EmptyState
        title="No files yet"
        hint="Upload documents your tasks should work with. Files a task saves for you appear here too."
      />
    );
  }
  return (
    <SettingsCard testID="jarvis3-files-list">
      {listing.folders.map((folder) => (
        <FolderRow key={folder.path} folder={folder} onOpen={onOpenFolder} />
      ))}
      {listing.files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          busy={busyPath === file.path}
          readOnly={readOnly}
          onDownload={onDownload}
          onDelete={onDelete}
          onMove={onMove}
        />
      ))}
    </SettingsCard>
  );
}

function FolderRow({ folder, onOpen }: { folder: FolderEntry; onOpen: (dir: string) => void }) {
  const open = useCallback(() => onOpen(folder.path), [onOpen, folder.path]);
  return (
    <Pressable
      style={styles.row}
      onPress={open}
      accessibilityRole="link"
      accessibilityLabel={`Folder ${folder.name}`}
      testID={`jarvis3-folder-${folder.path}`}
    >
      <View style={styles.main}>
        <Text style={styles.name} numberOfLines={1}>
          {`${folder.name}/`}
        </Text>
        <Text style={styles.hint}>
          {`${folder.count} file${folder.count === 1 ? "" : "s"} · ${formatBytes(folder.size)}`}
        </Text>
      </View>
    </Pressable>
  );
}

function FileRow({
  file,
  busy,
  readOnly,
  onDownload,
  onDelete,
  onMove,
}: {
  file: FileView;
  busy: boolean;
  readOnly: boolean;
  onDownload: (file: FileView) => void;
  onDelete: (file: FileView) => void;
  onMove: (file: FileView) => void;
}) {
  const download = useCallback(() => onDownload(file), [onDownload, file]);
  const remove = useCallback(() => onDelete(file), [onDelete, file]);
  const move = useCallback(() => onMove(file), [onMove, file]);
  const source = fileSourceLabel(file);
  const details = [formatBytes(file.size), formatWhen(file.updatedAt), source].filter(Boolean);
  return (
    <View style={styles.row} testID={`jarvis3-file-${file.path}`}>
      <View style={styles.main}>
        <Text style={styles.name} numberOfLines={2}>
          {baseName(file.path)}
        </Text>
        <Text style={styles.hint}>{busy ? "Working…" : details.join(" · ")}</Text>
      </View>
      <View style={styles.actions}>
        <Button
          variant="outline"
          size="sm"
          onPress={download}
          testID={`jarvis3-file-download-${file.path}`}
        >
          Download
        </Button>
        {readOnly ? null : (
          <>
            <Button
              variant="ghost"
              size="sm"
              onPress={move}
              disabled={busy}
              testID={`jarvis3-file-move-${file.path}`}
            >
              Rename
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={remove}
              disabled={busy}
              testID={`jarvis3-file-delete-${file.path}`}
            >
              Delete
            </Button>
          </>
        )}
      </View>
    </View>
  );
}

/** Rename or move: the new path, folders included ("reports/q3.pdf"). */
function MoveEditor({
  file,
  files,
  store,
  onDone,
}: {
  file: FileView;
  files: readonly FileView[];
  store: FilesStore;
  onDone: () => void;
}) {
  const [to, setTo] = useState(file.path);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = useCallback(() => {
    const plan = planMove(files, file.path, to);
    if (!plan.ok) {
      setError(plan.error);
      return;
    }
    const run = async () => {
      setSaving(true);
      const failure = await store.move(file.path, plan.to);
      setSaving(false);
      if (failure) setError(failure);
      else onDone();
    };
    void run();
  }, [files, file.path, to, store, onDone]);
  return (
    <SettingsCard testID="jarvis3-file-move-editor">
      <SettingsInput
        label="New name"
        hint="Use “/” for folders, e.g. reports/q3.pdf."
        initialValue={file.path}
        onChangeText={setTo}
        error={error ?? undefined}
      />
      <View style={styles.editorButtons}>
        <Button variant="ghost" size="sm" onPress={onDone}>
          Cancel
        </Button>
        <Button
          variant="default"
          size="sm"
          onPress={save}
          loading={saving}
          testID="jarvis3-file-move-save"
        >
          Save
        </Button>
      </View>
    </SettingsCard>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: { xs: "column", md: "row" },
    alignItems: { xs: "stretch", md: "center" },
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  main: {
    flex: 1,
    gap: theme.spacing[1],
  },
  name: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    justifyContent: { xs: "flex-start", md: "flex-end" },
  },
  crumbs: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  crumbItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  crumbLink: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.sm,
  },
  crumbCurrent: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  uploadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  editorButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
  },
}));
