// A chat. While its agent is connected: Paseo's own conversation panel (answers with step chips,
// its composer). Otherwise (a new chat starting, or one whose machine went to sleep): the
// conversation as the instance indexed it, what this app just sent, a quiet "Starting…" line
// while the agent wakes, and a composer; sending queues the message on the instance, which wakes
// the chat. No machine state, pause, resume or destroy anywhere.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ScrollView as NativeScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { MoreHorizontal } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AssistantMessage, ToolCall, UserMessage } from "@/components/message";
import { ToolCallSheetProvider } from "@/components/tool-call-sheet";
import { AssistantFileLinkResolverProvider } from "@/assistant-file-links/provider";
import { AgentConversationPanel } from "@/panels/agent-panel";
import {
  createPaneFocusContextValue,
  PaneFocusProvider,
  PaneProvider,
  type PaneContextValue,
} from "@/panels/pane-context";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatus,
  useHosts,
} from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import type { TaskView, TranscriptEntry } from "../api-types";
import { REFRESH_TASK_APPROVALS_MS } from "../approvals";
import { useChatActions } from "../chat-actions";
import {
  chatNeedsPolling,
  type ChatView,
  newRequestId,
  parseToolEntry,
  planChatView,
  type SentMessage,
  unseenMessages,
} from "../chats";
import {
  approvalsStore,
  chatMessagesStore,
  jarvis3Api,
  taskExtrasStore,
  tasksStore,
} from "../client";
import { ChatComposer } from "../composer";
import { useAccount, useApprovals, useChatMessages, useTaskExtras } from "../hooks";
import { KeyboardFrame } from "../keyboard-frame";
import { NEW_CHAT_HREF } from "../nav";
import { Jarvis3Error, taskAgentOnHost } from "../plan";
import { REFRESH_TASK_EXTRAS_MS, taskExtrasLine } from "../schedules";
import { messageOf, REFRESH_WHILE_CHANGING_MS } from "../stores";
import { ensureTaskHost, findTaskHost } from "../task-host";
import { Banner, EmptyState, Jarvis3Frame } from "../ui";
import { formatWhen } from "./format";

const HISTORY_PAGE = 100;
const LATEST = 999_999_999_999_999;
const NO_SENT: readonly SentMessage[] = [];

function asJarvis3Error(error: unknown): Jarvis3Error {
  return error instanceof Jarvis3Error ? error : new Jarvis3Error(messageOf(error), 0, "network");
}

function useChatTask(taskId: string) {
  const [task, setTask] = useState<TaskView | null>(null);
  const [loadError, setLoadError] = useState<Jarvis3Error | null>(null);
  const load = useCallback(() => {
    const run = async () => {
      try {
        const next = await jarvis3Api.getTask(taskId);
        setTask(next);
        setLoadError(null);
        tasksStore.upsert(next);
      } catch (error) {
        setLoadError(asJarvis3Error(error));
      }
    };
    void run();
  }, [taskId]);
  // A rename (the sidebar or the header) updates the list store; follow it.
  useEffect(
    () =>
      tasksStore.subscribe(() => {
        const listed = tasksStore.get().tasks.find((t) => t.id === taskId);
        if (listed) setTask((current) => (current && listed !== current ? listed : current));
      }),
    [taskId],
  );
  return { task, loadError, load };
}

/** The indexed conversation (main agent, the latest page), reloaded when the chat had activity. */
function useHistory(taskId: string, enabled: boolean, activity: string | null) {
  const [entries, setEntries] = useState<TranscriptEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const page = await jarvis3Api.transcript(taskId, { before: LATEST, limit: HISTORY_PAGE });
        if (cancelled) return;
        setEntries(page.entries);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(messageOf(e));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [taskId, enabled, activity]);
  return { entries, error };
}

export function ChatScreen({ taskId }: { taskId: string }) {
  const { task, loadError, load } = useChatTask(taskId);
  const [connectError, setConnectError] = useState<string | null>(null);
  const sent = useChatMessages().sent[taskId] ?? NO_SENT;
  const actions = useChatActions();

  useEffect(() => {
    load();
  }, [load]);

  const hosts = useHosts();
  const host = useMemo(() => findTaskHost(hosts, taskId), [hosts, taskId]);
  const serverId = host?.serverId ?? null;
  const status = useHostRuntimeConnectionStatus(serverId ?? "");
  const agentIds = useSessionStore(
    useShallow((state) =>
      serverId ? Array.from(state.sessions[serverId]?.agents?.keys() ?? []) : [],
    ),
  );
  const agentWorkspaceId = useSessionStore((state) => {
    const id = task?.agentId;
    return (serverId && id && state.sessions[serverId]?.agents?.get(id)?.workspaceId) || "";
  });
  const agentId = useMemo(() => taskAgentOnHost(task, agentIds), [task, agentIds]);
  const awaitingReply = sent.some((m) => m.state !== "failed");

  const view = planChatView({
    task,
    loadError,
    hostServerId: serverId,
    hostOnline: status === "online",
    agentId,
    awaitingReply,
  });

  // Poll while the chat is on its way to the live conversation.
  const polling = chatNeedsPolling(view, task);
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setInterval(load, REFRESH_WHILE_CHANGING_MS);
    return () => clearInterval(timer);
  }, [polling, load]);

  // Make the chat's host (probe the daemon through the proxy) once its agent is connected.
  const connect = view.kind === "history" && view.connect;
  useEffect(() => {
    if (!connect || !task) return;
    setConnectError(null);
    ensureTaskHost(task.id, task.title).catch((error: unknown) =>
      setConnectError(messageOf(error)),
    );
    // retried on each poll (a new `task`)
  }, [connect, task]);

  // Live: the conversation shows everything; what this app sent is in it.
  const live = view.kind === "live";
  useEffect(() => {
    if (live) chatMessagesStore.clearSent(taskId);
  }, [live, taskId]);

  const title = view.kind === "not_found" ? "Chat not found" : (task?.title ?? "Chat");
  const rename = useCallback(() => {
    if (task) actions.rename(task);
  }, [actions, task]);
  const remove = useCallback(() => {
    if (task) actions.remove(task);
  }, [actions, task]);
  const showMenu = task !== null && view.kind !== "deleted";
  const menu = useMemo(
    () =>
      showMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            style={styles.kebab}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Chat actions"
            testID="jarvis3-chat-menu"
          >
            <ThemedMore size={18} uniProps={muted} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" width={180}>
            <DropdownMenuItem onSelect={rename} testID="jarvis3-chat-rename">
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={remove} testID="jarvis3-chat-delete">
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null,
    [showMenu, rename, remove],
  );

  return (
    <Jarvis3Frame title={title} scroll={false} testID="jarvis3-chat-screen" actions={menu}>
      {task && task.projects?.length ? (
        <Text style={styles.projects} numberOfLines={1} testID="jarvis3-chat-projects">
          {`Projects: ${task.projects.map((p) => p.name).join(", ")}`}
        </Text>
      ) : null}
      <ApprovalNotice taskId={taskId} />
      <ExtrasNotice taskId={taskId} />
      <ChatBody
        view={view}
        task={task}
        sent={sent}
        workspaceId={agentWorkspaceId}
        connectError={connectError}
        onRetry={load}
      />
      {actions.dialogs}
    </Jarvis3Frame>
  );
}

function ChatBody({
  view,
  task,
  sent,
  workspaceId,
  connectError,
  onRetry,
}: {
  view: ChatView;
  task: TaskView | null;
  sent: readonly SentMessage[];
  workspaceId: string;
  connectError: string | null;
  onRetry: () => void;
}) {
  switch (view.kind) {
    case "loading":
      return <EmptyState title="Loading…" />;
    case "not_found":
      return <NotFound />;
    case "deleted":
      return <EmptyState title="This chat was deleted." />;
    case "error":
      return (
        <EmptyState title={view.message}>
          <Button variant="outline" size="sm" onPress={onRetry}>
            Try again
          </Button>
        </EmptyState>
      );
    case "live":
      return (
        <LiveConversation
          serverId={view.serverId}
          agentId={view.agentId}
          workspaceId={workspaceId}
        />
      );
    case "history":
      return task ? (
        <HistoryConversation
          task={task}
          sent={sent}
          working={view.working}
          failed={view.failed}
          connectError={connectError}
        />
      ) : null;
  }
}

function NotFound() {
  const router = useRouter();
  const back = useCallback(() => router.replace(NEW_CHAT_HREF as Href), [router]);
  return (
    <EmptyState title="This chat doesn't exist, or isn't yours.">
      <Button variant="outline" onPress={back} testID="jarvis3-back-to-new-chat">
        New chat
      </Button>
    </EmptyState>
  );
}

function HistoryConversation({
  task,
  sent,
  working,
  failed,
  connectError,
}: {
  task: TaskView;
  sent: readonly SentMessage[];
  working: boolean;
  failed: string | null;
  connectError: string | null;
}) {
  const history = useHistory(task.id, true, task.lastActivityAt ?? null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scroll = useRef<NativeScrollView>(null);
  const unseen = useMemo(
    () => unseenMessages(sent, history.entries ?? []),
    [sent, history.entries],
  );
  const send = useCallback(
    async (text: string) => {
      setSending(true);
      setError(null);
      const failure = await chatMessagesStore.send(task.id, newRequestId(), text);
      setSending(false);
      if (failure) {
        setError(failure);
        // the text stays in the box; the failed copy isn't kept
        const last = chatMessagesStore.get().sent[task.id]?.filter((m) => m.state === "failed");
        for (const m of last ?? []) chatMessagesStore.discard(task.id, m.id);
        return false;
      }
      return true;
    },
    [task.id],
  );
  const toEnd = useCallback(() => scroll.current?.scrollToEnd({ animated: false }), []);
  const empty = (history.entries?.length ?? 0) === 0 && unseen.length === 0;
  return (
    <KeyboardFrame style={styles.body}>
      <NativeScrollView
        ref={scroll}
        style={styles.fill}
        contentContainerStyle={styles.history}
        onContentSizeChange={toEnd}
        testID="jarvis3-history"
      >
        <ToolCallSheetProvider>
          {/* No daemon while asleep: file links in answers just don't resolve. */}
          <AssistantFileLinkResolverProvider>
            {history.error && !empty ? <Banner tone="error">{history.error}</Banner> : null}
            {(history.entries ?? []).map((entry) => (
              <HistoryEntry key={`${entry.agentId}:${entry.seq}`} entry={entry} />
            ))}
            {unseen.map((message) => (
              <UserMessage
                key={message.id}
                message={message.text}
                timestamp={message.at}
                isPending={message.state === "sending"}
              />
            ))}
            {working && !failed ? (
              <Text style={styles.typing} testID="jarvis3-chat-starting">
                Starting…
              </Text>
            ) : null}
          </AssistantFileLinkResolverProvider>
        </ToolCallSheetProvider>
      </NativeScrollView>
      {connectError ? <Banner tone="error">{connectError}</Banner> : null}
      {failed ? (
        <Banner tone="error" testID="jarvis3-chat-failed">
          {`This chat couldn't start: ${failed} Start a new chat to try again.`}
        </Banner>
      ) : null}
      {error ? (
        <Banner tone="error" testID="jarvis3-chat-send-error">
          {error}
        </Banner>
      ) : null}
      {failed ? null : (
        <View style={styles.composer}>
          <ChatComposer
            placeholder="Reply to Jarvis"
            busy={sending}
            onSend={send}
            testID="jarvis3-reply"
          />
        </View>
      )}
    </KeyboardFrame>
  );
}

function HistoryEntry({ entry }: { entry: TranscriptEntry }) {
  const at = Date.parse(entry.at) || 0;
  if (entry.role === "user") return <UserMessage message={entry.text} timestamp={at} />;
  if (entry.role === "assistant") {
    return (
      <AssistantMessage
        occurrenceKey={`${entry.agentId}:${entry.seq}`}
        message={entry.text}
        timestamp={at}
        phase="complete"
      />
    );
  }
  return <HistoryStep text={entry.text} />;
}

function HistoryStep({ text }: { text: string }) {
  const step = useMemo(() => parseToolEntry(text), [text]);
  const detail = useMemo(
    () => ({ type: "unknown" as const, input: step.summary || null, output: step.details || null }),
    [step],
  );
  return <ToolCall toolName={step.name} status="completed" detail={detail} forceInline />;
}

/** "Waiting on you" when this chat asked for a decision the viewer can make. */
function ApprovalNotice({ taskId }: { taskId: string }) {
  const router = useRouter();
  const pending = useApprovals().pendingByTask[taskId];
  useEffect(() => {
    void approvalsStore.loadForTask(taskId);
    const timer = setInterval(
      () => void approvalsStore.loadForTask(taskId),
      REFRESH_TASK_APPROVALS_MS,
    );
    return () => clearInterval(timer);
  }, [taskId]);
  const first = pending?.[0];
  const count = pending?.length ?? 0;
  const review = useCallback(() => {
    if (count > 1) router.push("/approvals" as Href);
    else if (first) router.push(`/approvals/${encodeURIComponent(first.id)}` as Href);
  }, [router, count, first]);
  if (!first) return null;
  return (
    <Banner tone="info" testID="jarvis3-chat-approval">
      {count > 1
        ? `Waiting on you: ${count} requests from this chat.`
        : `Waiting on you: ${first.preview.summary}`}
      <Button variant="outline" size="sm" onPress={review} testID="jarvis3-chat-approval-review">
        Review
      </Button>
    </Banner>
  );
}

/** One line with the chat's channel posts and its next wakeup, linking to its channel page. */
function ExtrasNotice({ taskId }: { taskId: string }) {
  const router = useRouter();
  const enabled = useAccount().me?.features?.schedules === true;
  const extras = useTaskExtras();
  useEffect(() => {
    if (!enabled) return undefined;
    const refresh = () => {
      void taskExtrasStore.loadChannels();
      void taskExtrasStore.loadWakeups(taskId);
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_TASK_EXTRAS_MS);
    return () => clearInterval(timer);
  }, [enabled, taskId]);
  const open = useCallback(
    () => router.push(`/channels/${encodeURIComponent(taskId)}` as Href),
    [router, taskId],
  );
  const line = taskExtrasLine({
    channel: extras.channels.find((c) => c.taskId === taskId) ?? null,
    wakeups: extras.wakeups[taskId]?.wakeups ?? [],
    formatWhen,
  });
  if (!enabled || !line) return null;
  return (
    <Banner tone="info" testID="jarvis3-chat-extras">
      {line}
      <Button variant="outline" size="sm" onPress={open} testID="jarvis3-chat-channel">
        Channel
      </Button>
    </Banner>
  );
}

const noop = () => undefined;

/**
 * What the workspace screen does for its visible agents: load the agent's timeline and mark it
 * viewed (so the daemon streams it), and mark it focused (attention, notifications).
 */
function useViewedAgent(serverId: string, agentId: string): void {
  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[serverId]?.viewedTimelineSync ?? null,
  );
  const setFocusedAgentId = useSessionStore((state) => state.setFocusedAgentId);
  const key = `jarvis3:${serverId}`;
  useEffect(() => {
    void getHostRuntimeStore()
      .prepareAgentTimeline(serverId, agentId)
      .catch(() => undefined);
  }, [serverId, agentId]);
  useLayoutEffect(() => {
    if (!viewedTimelineSync) return undefined;
    viewedTimelineSync.replaceVisibleAgentIds(key, [agentId]);
    return () => viewedTimelineSync.replaceVisibleAgentIds(key, []);
  }, [viewedTimelineSync, key, agentId]);
  useEffect(() => {
    setFocusedAgentId(serverId, agentId);
    return () => setFocusedAgentId(serverId, null);
  }, [setFocusedAgentId, serverId, agentId]);
}

function LiveConversation({
  serverId,
  agentId,
  workspaceId,
}: {
  serverId: string;
  agentId: string;
  workspaceId: string;
}) {
  const pane = useMemo<PaneContextValue>(
    () => ({
      serverId,
      workspaceId,
      host: "main",
      tabId: `jarvis3-${agentId}`,
      target: { kind: "agent", agentId },
      openTab: noop,
      openPreferredTarget: noop,
      closeCurrentTab: noop,
      retargetCurrentTab: noop,
      setCurrentTabState: noop,
      openFileInWorkspace: noop,
      openImportSheet: noop,
    }),
    [serverId, workspaceId, agentId],
  );
  const focus = useMemo(
    () => createPaneFocusContextValue({ isWorkspaceFocused: true, isPaneFocused: true }),
    [],
  );
  useViewedAgent(serverId, agentId);
  return (
    <View style={styles.live} testID="jarvis3-chat">
      <PaneProvider value={pane}>
        <PaneFocusProvider value={focus}>
          <AgentConversationPanel />
        </PaneFocusProvider>
      </PaneProvider>
    </View>
  );
}

const ThemedMore = withUnistyles(MoreHorizontal);
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const styles = StyleSheet.create((theme) => ({
  fill: {
    flex: 1,
  },
  body: {
    flex: 1,
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[4],
  },
  history: {
    flexGrow: 1,
    justifyContent: "flex-end",
    paddingBottom: theme.spacing[2],
  },
  typing: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[3],
  },
  composer: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  live: {
    flex: 1,
    minHeight: 320,
    marginHorizontal: -theme.spacing[4],
  },
  projects: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  kebab: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
}));
