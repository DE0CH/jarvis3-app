import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsSelect } from "@/components/settings";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { ScrollView } from "@/components/ui/scroll-view";
import type { FileView } from "../api-types";
import { pickFilesToUpload } from "../pick-files";
import { jarvis3Api, tasksStore } from "../client";
import { ATTACHMENTS_MAX, attachmentList, chooserFiles, formatBytes, toggleChosen } from "../files";
import { attachmentItems, type PickedFile, uploadPicked, type UploadItem } from "../files-store";
import { useAccount } from "../hooks";
import { messageOf } from "../stores";
import { Banner, CenteredDialog, Jarvis3Frame } from "../ui";
import { countOf } from "../count";
import { uploadLabel } from "./files-screen";
import { formatWhen } from "./format";

const PROMPT_MAX = 16_000;

function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function NewTaskScreen() {
  const router = useRouter();
  const account = useAccount();
  const models = account.models;
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per form, so a double press or a retry after a dropped answer creates one task.
  const requestId = useRef(newRequestId());
  const filesOn = account.me?.features?.files === true;
  // Picked files and their upload state, index for index.
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  // Files already in the user's Files, attached by path (no upload).
  const [chosen, setChosen] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(false);

  const options = useMemo(
    () => (models?.models ?? []).map((entry) => ({ label: entry.label, value: entry.id })),
    [models],
  );
  const selectedModel = model ?? models?.default ?? options[0]?.value ?? "";
  const capReached = account.me?.usage.machineHoursCapReached === true;
  const trimmed = prompt.trim();

  const attach = useCallback(() => {
    const run = async () => {
      try {
        const more = await pickFilesToUpload();
        if (!more?.length) return;
        const all = [...picked, ...more].slice(0, ATTACHMENTS_MAX - chosen.length);
        const done = new Map(uploads.map((item) => [item.path, item]));
        setPicked(all);
        // Paths are planned over every picked file so names stay unique; what already went up
        // keeps its state.
        setUploads(
          attachmentItems(requestId.current, all).map((item) => done.get(item.path) ?? item),
        );
      } catch (e) {
        setError(messageOf(e));
      }
    };
    void run();
  }, [picked, uploads, chosen.length]);
  const detach = useCallback(
    (index: number) => {
      // Names are planned again, so each file uploads (again) on submit: a PUT replaces.
      const rest = picked.filter((_, i) => i !== index);
      setPicked(rest);
      setUploads(attachmentItems(requestId.current, rest));
    },
    [picked],
  );

  const submit = useCallback(() => {
    if (!trimmed || submitting) return;
    const run = async () => {
      setSubmitting(true);
      setError(null);
      try {
        // Upload what isn't up yet (a retry skips what is), then create the task with the paths.
        const items = await uploadPicked(jarvis3Api, uploads, picked, null, "me", setUploads);
        const failed = items.find((item) => item.state === "failed");
        if (failed) {
          setError(`${failed.name} couldn't be uploaded: ${failed.error ?? "unknown error"}`);
          setSubmitting(false);
          return;
        }
        const task = await tasksStore.create({
          prompt: trimmed,
          ...(selectedModel ? { model: selectedModel } : {}),
          requestId: requestId.current,
          ...(items.length || chosen.length
            ? {
                attachments: attachmentList(
                  items.map((item) => item.path),
                  chosen,
                ),
              }
            : {}),
        });
        router.replace(`/tasks/${encodeURIComponent(task.id)}` as Href);
      } catch (e) {
        setError(messageOf(e));
        setSubmitting(false);
      }
    };
    void run();
  }, [trimmed, submitting, selectedModel, router, uploads, picked, chosen]);
  const openChooser = useCallback(() => setChoosing(true), []);
  const closeChooser = useCallback(() => setChoosing(false), []);
  const applyChosen = useCallback((paths: string[]) => {
    setChosen(paths);
    setChoosing(false);
  }, []);
  const unchoose = useCallback(
    (path: string) => setChosen((current) => current.filter((p) => p !== path)),
    [],
  );
  const cancel = useCallback(() => router.back(), [router]);

  return (
    <Jarvis3Frame title="New task" testID="jarvis3-new-task-screen">
      {capReached ? (
        <Banner tone="error">
          Your machine hours for this month are used up. Ask your admin to raise your limit.
        </Banner>
      ) : null}
      <View style={styles.field}>
        <Text style={styles.label}>What should the agent do?</Text>
        <SettingsTextAreaCard
          accessibilityLabel="First message"
          value=""
          onChangeText={setPrompt}
          placeholder="Describe the task, as you would to a colleague."
          testID="jarvis3-new-task-prompt"
          style={styles.prompt}
        />
        {prompt.length > PROMPT_MAX ? (
          <Text style={styles.error}>The first message is limited to 16,000 characters.</Text>
        ) : null}
      </View>
      {filesOn ? (
        <Attachments
          items={uploads}
          chosen={chosen}
          busy={submitting}
          onAttach={attach}
          onChoose={openChooser}
          onRemove={detach}
          onUnchoose={unchoose}
        />
      ) : null}
      {filesOn ? (
        <FromFilesDialog
          visible={choosing}
          initial={chosen}
          room={ATTACHMENTS_MAX - picked.length}
          onCancel={closeChooser}
          onDone={applyChosen}
        />
      ) : null}
      {options.length > 0 ? (
        <SettingsCard>
          <SettingsSelect
            label="Model"
            hint="The organisation's chosen models."
            value={selectedModel}
            options={options}
            onValueChange={setModel}
          />
        </SettingsCard>
      ) : null}
      {error ? (
        <Banner tone="error" testID="jarvis3-new-task-error">
          {error}
        </Banner>
      ) : null}
      <View style={styles.buttons}>
        <Button variant="ghost" onPress={cancel} testID="jarvis3-new-task-cancel">
          Cancel
        </Button>
        <Button
          variant="default"
          onPress={submit}
          loading={submitting}
          disabled={!trimmed || prompt.length > PROMPT_MAX || capReached}
          testID="jarvis3-new-task-submit"
        >
          Start task
        </Button>
      </View>
    </Jarvis3Frame>
  );
}

function Attachments({
  items,
  chosen,
  busy,
  onAttach,
  onChoose,
  onRemove,
  onUnchoose,
}: {
  items: UploadItem[];
  chosen: string[];
  busy: boolean;
  onAttach: () => void;
  onChoose: () => void;
  onRemove: (index: number) => void;
  onUnchoose: (path: string) => void;
}) {
  const full = items.length + chosen.length >= ATTACHMENTS_MAX;
  return (
    <SettingsCard testID="jarvis3-new-task-attachments">
      {items.map((item, index) => (
        <AttachmentRow key={item.path} item={item} index={index} busy={busy} onRemove={onRemove} />
      ))}
      {chosen.map((path) => (
        <ChosenRow key={path} path={path} busy={busy} onRemove={onUnchoose} />
      ))}
      <View style={styles.attachRow}>
        <Text style={styles.label}>
          {items.length || chosen.length
            ? "The agent finds these in ~/workspace/attachments; they are also kept in your Files."
            : "Attach documents or photos for the agent (optional), new or from your Files."}
        </Text>
        <View style={styles.attachButtons}>
          <Button
            variant="outline"
            size="sm"
            onPress={onChoose}
            disabled={busy || (full && chosen.length === 0)}
            testID="jarvis3-new-task-from-files"
          >
            From my files
          </Button>
          <Button
            variant="outline"
            size="sm"
            onPress={onAttach}
            disabled={busy || full}
            testID="jarvis3-new-task-attach"
          >
            Attach files
          </Button>
        </View>
      </View>
    </SettingsCard>
  );
}

function ChosenRow({
  path,
  busy,
  onRemove,
}: {
  path: string;
  busy: boolean;
  onRemove: (path: string) => void;
}) {
  const remove = useCallback(() => onRemove(path), [onRemove, path]);
  return (
    <View style={styles.attachRow} testID={`jarvis3-chosen-${path}`}>
      <View style={styles.attachText}>
        <Text style={styles.attachName} numberOfLines={1}>
          {path}
        </Text>
        <Text style={styles.label}>In your Files</Text>
      </View>
      <Button variant="ghost" size="sm" onPress={remove} disabled={busy}>
        Remove
      </Button>
    </View>
  );
}

/** "From my files": pick files already in the user's Files; they are attached by path. */
function FromFilesDialog({
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

function AttachmentRow({
  item,
  index,
  busy,
  onRemove,
}: {
  item: UploadItem;
  index: number;
  busy: boolean;
  onRemove: (index: number) => void;
}) {
  const remove = useCallback(() => onRemove(index), [onRemove, index]);
  return (
    <View style={styles.attachRow} testID={`jarvis3-attachment-${index}`}>
      <View style={styles.attachText}>
        <Text style={styles.attachName} numberOfLines={1}>
          {item.name}
        </Text>
        {item.state === "waiting" ? null : (
          <Text style={item.state === "failed" ? styles.error : styles.label}>
            {uploadLabel(item)}
          </Text>
        )}
      </View>
      <Button variant="ghost" size="sm" onPress={remove} disabled={busy}>
        Remove
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  attachRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  attachButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
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
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginLeft: theme.spacing[1],
    flexShrink: 1,
  },
  prompt: {
    minHeight: 180,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  buttons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
