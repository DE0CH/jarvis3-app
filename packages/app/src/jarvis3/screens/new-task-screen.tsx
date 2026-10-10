import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsSelect } from "@/components/settings";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Button } from "@/components/ui/button";
import { useFilePicker } from "@/hooks/use-file-picker";
import { jarvis3Api, tasksStore } from "../client";
import { ATTACHMENTS_MAX } from "../files";
import { attachmentItems, type PickedFile, uploadPicked, type UploadItem } from "../files-store";
import { useAccount } from "../hooks";
import { messageOf } from "../stores";
import { Banner, Jarvis3Frame } from "../ui";
import { uploadLabel } from "./files-screen";

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
  const { pickFiles } = useFilePicker();
  // Picked files and their upload state, index for index.
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

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
        const more = await pickFiles();
        if (!more?.length) return;
        const all = [...picked, ...more].slice(0, ATTACHMENTS_MAX);
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
  }, [pickFiles, picked, uploads]);
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
          ...(items.length ? { attachments: items.map((item) => item.path) } : {}),
        });
        router.replace(`/tasks/${encodeURIComponent(task.id)}` as Href);
      } catch (e) {
        setError(messageOf(e));
        setSubmitting(false);
      }
    };
    void run();
  }, [trimmed, submitting, selectedModel, router, uploads, picked]);
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
        <Attachments items={uploads} busy={submitting} onAttach={attach} onRemove={detach} />
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
  busy,
  onAttach,
  onRemove,
}: {
  items: UploadItem[];
  busy: boolean;
  onAttach: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <SettingsCard testID="jarvis3-new-task-attachments">
      {items.map((item, index) => (
        <AttachmentRow key={item.path} item={item} index={index} busy={busy} onRemove={onRemove} />
      ))}
      <View style={styles.attachRow}>
        <Text style={styles.label}>
          {items.length
            ? "The agent finds these in ~/workspace/attachments; they are also kept in your Files."
            : "Attach documents or photos for the agent (optional)."}
        </Text>
        <Button
          variant="outline"
          size="sm"
          onPress={onAttach}
          disabled={busy || items.length >= ATTACHMENTS_MAX}
          testID="jarvis3-new-task-attach"
        >
          Attach files
        </Button>
      </View>
    </SettingsCard>
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
