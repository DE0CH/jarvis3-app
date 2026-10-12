// The app's first screen, like the chat apps: an empty chat with the composer focused (the
// keyboard up on a phone). The composer picks the model, Projects (repos and secrets for this
// chat) and attachments (uploaded, or from Files). Sending creates the chat (POST /api/tasks with
// the text as its first message), which appears in the sidebar at once, and opens it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, FolderGit2, Paperclip, X } from "lucide-react-native";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Theme } from "@/styles/theme";
import type { ModelList, ProjectView } from "../api-types";
import { newRequestId } from "../chats";
import { chatMessagesStore, jarvis3Api, projectsStore, tasksStore } from "../client";
import { ChatComposer } from "../composer";
import { ATTACHMENTS_MAX, attachmentList, baseName } from "../files";
import { attachmentItems, type PickedFile, uploadPicked, type UploadItem } from "../files-store";
import { useAccount, useProjects } from "../hooks";
import { KeyboardFrame } from "../keyboard-frame";
import { chatHref } from "../nav";
import { pickFilesToUpload } from "../pick-files";
import { toggleProject } from "../projects";
import { messageOf } from "../stores";
import { Banner, Jarvis3Frame } from "../ui";
import { FromFilesDialog } from "./from-files-dialog";
import { uploadLabel } from "./files-screen";

interface Attachments {
  picked: PickedFile[];
  uploads: UploadItem[];
  chosen: string[];
}

/** The new chat's state and actions: model, Projects, attachments, and Send. */
function useNewChat() {
  const router = useRouter();
  const account = useAccount();
  // One id per chat being written: a double press or a retry makes one chat.
  const requestId = useRef(newRequestId());
  const [model, setModel] = useState<string | null>(null);
  const [files, setFiles] = useState<Attachments>({ picked: [], uploads: [], chosen: [] });
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const models = account.models;
  const selectedModel = model ?? models?.default ?? models?.models[0]?.id ?? "";

  const setUploads = useCallback(
    (uploads: UploadItem[]) => setFiles((current) => ({ ...current, uploads })),
    [],
  );
  const attach = useCallback(() => {
    const run = async () => {
      try {
        const more = await pickFilesToUpload();
        if (!more?.length) return;
        setFiles((current) => {
          const all = [...current.picked, ...more].slice(
            0,
            ATTACHMENTS_MAX - current.chosen.length,
          );
          const done = new Map(current.uploads.map((item) => [item.path, item]));
          const uploads = attachmentItems(requestId.current, all).map(
            (item) => done.get(item.path) ?? item,
          );
          return { ...current, picked: all, uploads };
        });
      } catch (e) {
        setError(messageOf(e));
      }
    };
    void run();
  }, []);
  const detach = useCallback((index: number) => {
    setFiles((current) => {
      const picked = current.picked.filter((_, i) => i !== index);
      return { ...current, picked, uploads: attachmentItems(requestId.current, picked) };
    });
  }, []);
  const setChosen = useCallback(
    (chosen: string[]) => setFiles((current) => ({ ...current, chosen })),
    [],
  );
  const unchoose = useCallback(
    (path: string) =>
      setFiles((current) => ({ ...current, chosen: current.chosen.filter((p) => p !== path) })),
    [],
  );
  const toggle = useCallback(
    (id: string) => setProjectIds((current) => toggleProject(current, id)),
    [],
  );

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      setError(null);
      try {
        const items = await uploadPicked(
          jarvis3Api,
          files.uploads,
          files.picked,
          null,
          "me",
          setUploads,
        );
        const failed = items.find((item) => item.state === "failed");
        if (failed) {
          setError(`${failed.name} couldn't be uploaded: ${failed.error ?? "unknown error"}`);
          return false;
        }
        const paths = attachmentList(
          items.map((item) => item.path),
          files.chosen,
        );
        const task = await tasksStore.create({
          prompt: text,
          ...(selectedModel ? { model: selectedModel } : {}),
          requestId: requestId.current,
          ...(paths.length ? { attachments: paths } : {}),
          ...(projectIds.length ? { projects: projectIds } : {}),
        });
        chatMessagesStore.recordFirst(task.id, requestId.current, text);
        router.replace(chatHref(task.id) as Href);
        return true;
      } catch (e) {
        setError(messageOf(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, files, selectedModel, projectIds, router, setUploads],
  );
  return {
    selectedModel,
    setModel,
    files,
    attach,
    detach,
    setChosen,
    unchoose,
    projectIds,
    toggle,
    busy,
    error,
    send,
  };
}

export function NewChatScreen() {
  const router = useRouter();
  const account = useAccount();
  const me = account.me;
  const filesOn = me?.features?.files === true;
  const projectsOn = me?.features?.projects === true;
  const capReached = me?.usage.machineHoursCapReached === true;
  const projects = useProjects();
  const chat = useNewChat();
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    if (projectsOn) void projectsStore.load();
  }, [projectsOn]);

  const openChooser = useCallback(() => setChoosing(true), []);
  const closeChooser = useCallback(() => setChoosing(false), []);
  const { setChosen } = chat;
  const applyChosen = useCallback(
    (paths: string[]) => {
      setChosen(paths);
      setChoosing(false);
    },
    [setChosen],
  );
  const manageProjects = useCallback(() => router.push("/projects" as Href), [router]);

  const models = account.models?.models;
  const tools = useMemo(
    () => (
      <>
        {filesOn ? <AttachMenu onUpload={chat.attach} onFromFiles={openChooser} /> : null}
        {models && models.length > 1 ? (
          <ModelMenu models={models} selected={chat.selectedModel} onSelect={chat.setModel} />
        ) : null}
        {projectsOn ? (
          <ProjectsMenu
            projects={projects.projects}
            picked={chat.projectIds}
            onToggle={chat.toggle}
            onManage={manageProjects}
          />
        ) : null}
      </>
    ),
    [
      filesOn,
      projectsOn,
      models,
      projects.projects,
      chat.attach,
      chat.selectedModel,
      chat.setModel,
      chat.projectIds,
      chat.toggle,
      openChooser,
      manageProjects,
    ],
  );
  const chips = useMemo(
    () => (
      <Chips
        projects={projects.projects.filter((p) => chat.projectIds.includes(p.id))}
        uploads={chat.files.uploads}
        chosen={chat.files.chosen}
        busy={chat.busy}
        onUnpick={chat.toggle}
        onDetach={chat.detach}
        onUnchoose={chat.unchoose}
      />
    ),
    [
      projects.projects,
      chat.projectIds,
      chat.files,
      chat.busy,
      chat.toggle,
      chat.detach,
      chat.unchoose,
    ],
  );

  return (
    <Jarvis3Frame title="New chat" scroll={false} testID="jarvis3-new-chat-screen">
      <KeyboardFrame style={styles.body}>
        <View style={styles.hero}>
          <Text style={styles.greeting} accessibilityRole="header">
            What can I help with?
          </Text>
        </View>
        {capReached ? (
          <Banner tone="error">
            Your machine hours for this month are used up. Ask your admin to raise your limit.
          </Banner>
        ) : null}
        {chat.error ? (
          <Banner tone="error" testID="jarvis3-new-chat-error">
            {chat.error}
          </Banner>
        ) : null}
        <View style={styles.composer}>
          <ChatComposer
            placeholder="Message Jarvis"
            autoFocus
            busy={chat.busy}
            disabled={capReached}
            onSend={chat.send}
            top={chips}
            tools={tools}
            testID="jarvis3-composer"
          />
        </View>
      </KeyboardFrame>
      {filesOn ? (
        <FromFilesDialog
          visible={choosing}
          initial={chat.files.chosen}
          room={ATTACHMENTS_MAX - chat.files.picked.length}
          onCancel={closeChooser}
          onDone={applyChosen}
        />
      ) : null}
    </Jarvis3Frame>
  );
}

function AttachMenu({ onUpload, onFromFiles }: { onUpload: () => void; onFromFiles: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={styles.iconButton}
        accessibilityRole="button"
        accessibilityLabel="Attach files"
        testID="jarvis3-composer-attach"
      >
        <ThemedPaperclip size={18} uniProps={muted} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" width={220}>
        <DropdownMenuItem onSelect={onUpload} testID="jarvis3-composer-upload">
          Upload files
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onFromFiles} testID="jarvis3-composer-from-files">
          From my Files
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelMenu({
  models,
  selected,
  onSelect,
}: {
  models: ModelList["models"];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const label = models.find((m) => m.id === selected)?.label ?? "Model";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={styles.pill}
        accessibilityRole="button"
        accessibilityLabel={`Model: ${label}`}
        testID="jarvis3-composer-model"
      >
        <Text style={styles.pillText} numberOfLines={1}>
          {label}
        </Text>
        <ThemedChevron size={14} uniProps={muted} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" width={260}>
        {models.map((entry) => (
          <ModelItem
            key={entry.id}
            id={entry.id}
            label={entry.label}
            selected={entry.id === selected}
            onSelect={onSelect}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelItem({
  id,
  label,
  selected,
  onSelect,
}: {
  id: string;
  label: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const select = useCallback(() => onSelect(id), [onSelect, id]);
  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      onSelect={select}
      testID={`jarvis3-model-${id}`}
    >
      {label}
    </DropdownMenuItem>
  );
}

function ProjectsMenu({
  projects,
  picked,
  onToggle,
  onManage,
}: {
  projects: ProjectView[];
  picked: string[];
  onToggle: (id: string) => void;
  onManage: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={styles.pill}
        accessibilityRole="button"
        accessibilityLabel="Projects"
        testID="jarvis3-composer-projects"
      >
        <ThemedProjects size={16} uniProps={muted} />
        <Text style={styles.pillText}>
          {picked.length ? `Projects (${picked.length})` : "Projects"}
        </Text>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" width={260}>
        {projects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            selected={picked.includes(project.id)}
            onToggle={onToggle}
          />
        ))}
        {projects.length ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onSelect={onManage} testID="jarvis3-manage-projects">
          {projects.length ? "Manage Projects" : "Create a Project"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectItem({
  project,
  selected,
  onToggle,
}: {
  project: ProjectView;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const toggle = useCallback(() => onToggle(project.id), [onToggle, project.id]);
  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      closeOnSelect={false}
      description={project.shared ? "Shared" : undefined}
      onSelect={toggle}
      testID={`jarvis3-pick-project-${project.id}`}
    >
      {project.name}
    </DropdownMenuItem>
  );
}

function Chips({
  projects,
  uploads,
  chosen,
  busy,
  onUnpick,
  onDetach,
  onUnchoose,
}: {
  projects: ProjectView[];
  uploads: UploadItem[];
  chosen: string[];
  busy: boolean;
  onUnpick: (id: string) => void;
  onDetach: (index: number) => void;
  onUnchoose: (path: string) => void;
}) {
  if (!projects.length && !uploads.length && !chosen.length) return null;
  return (
    <View style={styles.chips}>
      {projects.map((project) => (
        <ProjectChip key={project.id} project={project} onRemove={onUnpick} />
      ))}
      {uploads.map((item, index) => (
        <UploadChip key={item.path} item={item} index={index} busy={busy} onRemove={onDetach} />
      ))}
      {chosen.map((path) => (
        <ChosenChip key={path} path={path} busy={busy} onRemove={onUnchoose} />
      ))}
    </View>
  );
}

function ProjectChip({
  project,
  onRemove,
}: {
  project: ProjectView;
  onRemove: (id: string) => void;
}) {
  const remove = useCallback(() => onRemove(project.id), [onRemove, project.id]);
  return (
    <Chip
      label={project.name}
      withProjectIcon
      onRemove={remove}
      testID={`jarvis3-chip-project-${project.id}`}
    />
  );
}

function UploadChip({
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
    <Chip
      label={item.name}
      hint={item.state === "waiting" ? null : uploadLabel(item)}
      error={item.state === "failed"}
      onRemove={busy ? undefined : remove}
      testID={`jarvis3-attachment-${index}`}
    />
  );
}

function ChosenChip({
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
    <Chip
      label={baseName(path)}
      hint="From Files"
      onRemove={busy ? undefined : remove}
      testID={`jarvis3-chosen-${path}`}
    />
  );
}

function Chip({
  label,
  hint,
  withProjectIcon,
  error,
  onRemove,
  testID,
}: {
  label: string;
  hint?: string | null;
  withProjectIcon?: boolean;
  error?: boolean;
  onRemove?: () => void;
  testID?: string;
}) {
  return (
    <View style={[styles.chip, error && styles.chipError]} testID={testID}>
      {withProjectIcon ? <ThemedProjects size={14} uniProps={muted} /> : null}
      <Text style={styles.chipText} numberOfLines={1}>
        {label}
      </Text>
      {hint ? (
        <Text style={[styles.chipHint, error && styles.chipHintError]} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          testID={testID ? `${testID}-remove` : undefined}
        >
          <ThemedX size={14} uniProps={muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const ThemedPaperclip = withUnistyles(Paperclip);
const ThemedChevron = withUnistyles(ChevronDown);
const ThemedProjects = withUnistyles(FolderGit2);
const ThemedX = withUnistyles(X);
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const styles = StyleSheet.create((theme) => ({
  body: {
    flex: 1,
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[4],
    // On a wide window the greeting and the composer sit together in the middle.
    justifyContent: { xs: "flex-end", md: "center" },
  },
  hero: {
    flex: { xs: 1, md: 0 },
    alignItems: "center",
    justifyContent: "center",
    minHeight: 80,
    paddingBottom: { xs: 0, md: theme.spacing[4] },
  },
  greeting: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
  },
  composer: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  iconButton: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    maxWidth: 220,
  },
  pillText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    maxWidth: "100%",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  chipError: {
    borderColor: theme.colors.statusDanger,
  },
  chipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  chipHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  chipHintError: {
    color: theme.colors.statusDanger,
  },
}));
