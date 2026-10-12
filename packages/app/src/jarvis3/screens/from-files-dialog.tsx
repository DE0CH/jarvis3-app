// "From my files": a centered dialog that picks files already in the user's Files, attached to a
// chat's first message by path (no upload). Used by the new chat's composer.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { FormTextInput } from "@/components/ui/form-field";
import { ScrollView } from "@/components/ui/scroll-view";
import type { FileView } from "../api-types";
import { jarvis3Api } from "../client";
import { countOf } from "../count";
import { chooserFiles, formatBytes, toggleChosen } from "../files";
import { messageOf } from "../stores";
import { CenteredDialog } from "../ui";
import { formatWhen } from "./format";

/** "From my files": pick files already in the user's Files; they are attached by path. */
export function FromFilesDialog({
  visible,
  initial,
  room,
  onCancel,
  onDone,
}: {
  visible: boolean;
  initial: string[];
  /** How many may be chosen (the attachment limit minus the picked uploads). */
  room: number;
  onCancel: () => void;
  onDone: (paths: string[]) => void;
}) {
  const [files, setFiles] = useState<FileView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState<string[]>(initial);

  useEffect(() => {
    if (!visible) return;
    setDraft(initial);
    setFilter("");
    setError(null);
    jarvis3Api
      .listFiles()
      .then((list) => setFiles(list.files))
      .catch((e: unknown) => setError(messageOf(e)));
  }, [visible, initial]);

  const shown = useMemo(() => chooserFiles(files ?? [], filter), [files, filter]);
  const toggle = useCallback(
    (path: string) => setDraft((current) => toggleChosen(current, path, room)),
    [room],
  );
  const done = useCallback(() => onDone(draft), [onDone, draft]);
  let message = "Loading your files…";
  if (error) message = error;
  else if (files && files.length === 0) message = "Your Files are empty. Upload files there first.";
  else if (files) {
    message = `Tap the files to attach (up to ${room}). They stay where they are in your Files.`;
  }

  return (
    <CenteredDialog
      visible={visible}
      title="Attach from your files"
      message={message}
      confirmLabel={draft.length ? `Attach ${countOf(draft.length, "file")}` : "Done"}
      onCancel={onCancel}
      onConfirm={done}
      testID="jarvis3-from-files-dialog"
    >
      {files && files.length > 0 ? (
        <View style={styles.chooser}>
          <FormTextInput
            initialValue=""
            onChangeText={setFilter}
            placeholder="Filter by name or folder"
            accessibilityLabel="Filter your files"
            size="sm"
            testID="jarvis3-from-files-filter"
          />
          <ScrollView style={styles.chooserList}>
            {shown.map((file) => (
              <ChooserRow
                key={file.path}
                file={file}
                selected={draft.includes(file.path)}
                onToggle={toggle}
              />
            ))}
            {shown.length === 0 ? <Text style={styles.label}>No file matches.</Text> : null}
          </ScrollView>
        </View>
      ) : null}
    </CenteredDialog>
  );
}

function ChooserRow({
  file,
  selected,
  onToggle,
}: {
  file: FileView;
  selected: boolean;
  onToggle: (path: string) => void;
}) {
  const press = useCallback(() => onToggle(file.path), [onToggle, file.path]);
  const checked = useMemo(() => ({ checked: selected }), [selected]);
  return (
    <Pressable
      onPress={press}
      style={selected ? styles.chooserRowSelected : styles.chooserRow}
      accessibilityRole="checkbox"
      accessibilityState={checked}
      testID={`jarvis3-from-files-${file.path}`}
    >
      <View style={styles.attachText}>
        <Text style={styles.attachName} numberOfLines={1}>
          {file.path}
        </Text>
        <Text style={styles.label}>
          {`${formatBytes(file.size)} · ${formatWhen(file.updatedAt)}`}
        </Text>
      </View>
      <Text style={selected ? styles.checkOn : styles.checkOff}>{selected ? "✓" : ""}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  chooser: {
    gap: theme.spacing[2],
  },
  chooserList: {
    maxHeight: 320,
  },
  chooserRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  chooserRowSelected: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  checkOn: {
    width: 20,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  checkOff: {
    width: 20,
  },
  attachText: {
    flex: 1,
    gap: theme.spacing[1],
  },
  attachName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginLeft: theme.spacing[1],
    flexShrink: 1,
  },
}));
