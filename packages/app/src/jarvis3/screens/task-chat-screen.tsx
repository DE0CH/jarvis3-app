// A task's chat: Paseo's own conversation panel for the task's agent, on the task's host, with
// none of the workspace chrome (no git/review panels, terminal, explorer or host settings).
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { Button } from "@/components/ui/button";
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
import type { TaskView } from "../api-types";
import { REFRESH_TASK_APPROVALS_MS } from "../approvals";
import { approvalsStore, jarvis3Api, taskExtrasStore, tasksStore } from "../client";
import { useAccount, useApprovals, useTaskExtras } from "../hooks";
import { REFRESH_TASK_EXTRAS_MS, taskExtrasLine } from "../schedules";
import { type ChatPhase, Jarvis3Error, planTaskChat, presentTask, taskAgentOnHost } from "../plan";
import { messageOf, REFRESH_WHILE_CHANGING_MS } from "../stores";
import { ensureTaskHost, findTaskHost } from "../task-host";
import { Banner, EmptyState, Jarvis3Frame, StatusPill } from "../ui";
import { formatWhen } from "./format";

const SETTLED: ReadonlySet<ChatPhase["kind"]> = new Set(["chat", "not_found", "paused", "closed"]);

function asJarvis3Error(error: unknown): Jarvis3Error {
  return error instanceof Jarvis3Error ? error : new Jarvis3Error(messageOf(error), 0, "network");
}

/** The task, polled while it changes state; Pause/Start actions on it. */
function useTask(taskId: string) {
  const [task, setTask] = useState<TaskView | null>(null);
  const [loadError, setLoadError] = useState<Jarvis3Error | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

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

  const act = useCallback((call: () => Promise<TaskView>) => {
    const run = async () => {
      setActing(true);
      setActionError(null);
      try {
        const next = await call();
        setTask(next);
        tasksStore.upsert(next);
      } catch (error) {
        setActionError(messageOf(error));
      } finally {
        setActing(false);
      }
    };
    void run();
  }, []);

  const pause = useCallback(() => act(() => jarvis3Api.pauseTask(taskId)), [act, taskId]);
  const resume = useCallback(() => act(() => jarvis3Api.resumeTask(taskId)), [act, taskId]);
  return { task, loadError, actionError, acting, load, pause, resume };
}

export function TaskChatScreen({ taskId }: { taskId: string }) {
  const { task, loadError, actionError, acting, load, pause, resume } = useTask(taskId);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  const hosts = useHosts();
  const host = useMemo(() => findTaskHost(hosts, taskId), [hosts, taskId]);
  const serverId = host?.serverId ?? null;
  const status = useHostRuntimeConnectionStatus(serverId ?? "");
  const agents = useSessionStore(
    useShallow((state) =>
      serverId ? Array.from(state.sessions[serverId]?.agents?.values() ?? []) : [],
    ),
  );
  // the agent the session reported as the task's own, once the host has it
  const agentId = useMemo(
    () =>
      taskAgentOnHost(
        task,
        agents.map((agent) => agent.id),
      ),
    [task, agents],
  );
  const agentWorkspaceId = agents.find((agent) => agent.id === agentId)?.workspaceId ?? "";

  const phase = planTaskChat({
    task,
    loadError,
    hostServerId: serverId,
    hostOnline: status === "online",
    agentId,
  });

  // Poll while the task is changing state, until the chat can open.
  const settled = SETTLED.has(phase.kind);
  useEffect(() => {
    if (settled) return;
    const timer = setInterval(load, REFRESH_WHILE_CHANGING_MS);
    return () => clearInterval(timer);
  }, [settled, load]);

  // Make the task's host (probe the daemon through the proxy) once the session is connected.
  // Polling refreshes `task`, so a failed probe is retried with the next poll.
  const connect = useCallback(() => {
    if (!task) return;
    setConnectError(null);
    ensureTaskHost(task.id, task.title).catch((error: unknown) =>
      setConnectError(messageOf(error)),
    );
  }, [task]);
  useEffect(() => {
    if (phase.kind === "connect") connect();
  }, [phase.kind, connect]);

  const view = task ? presentTask(task) : null;
  const title = phase.kind === "not_found" ? "Task not found" : (task?.title ?? "Task");
  const actions = useMemo(
    () => (
      <>
        {view ? (
          <StatusPill tone={view.tone} label={view.label} testID="jarvis3-chat-state" />
        ) : null}
        {view?.canPause ? (
          <Button
            variant="ghost"
            size="sm"
            loading={acting}
            onPress={pause}
            testID="jarvis3-chat-pause"
          >
            Pause
          </Button>
        ) : null}
      </>
    ),
    [view, acting, pause],
  );

  return (
    <Jarvis3Frame
      title={title}
      scroll={phase.kind !== "chat"}
      testID="jarvis3-task-chat"
      actions={actions}
    >
      {actionError ? <Banner tone="error">{actionError}</Banner> : null}
      {task?.error ? <Banner tone="error">{task.error}</Banner> : null}
      <TaskApprovalNotice taskId={taskId} />
      <TaskExtrasNotice taskId={taskId} />
      <ChatPhaseView
        phase={phase}
        workspaceId={agentWorkspaceId}
        acting={acting}
        connectError={connectError}
        onRetryLoad={load}
        onResume={resume}
        onRetryConnect={connect}
      />
    </Jarvis3Frame>
  );
}

/** One line when this task waits for the viewer's approval, with a link to it. */
function TaskApprovalNotice({ taskId }: { taskId: string }) {
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
        ? `${count} requests from this task wait for your decision.`
        : `Waiting for your decision: ${first.preview.summary}`}
      <Button variant="outline" size="sm" onPress={review} testID="jarvis3-chat-approval-review">
        Review
      </Button>
    </Banner>
  );
}

/** One line with the task's channel posts and its next wakeup, linking to its channel page. */
function TaskExtrasNotice({ taskId }: { taskId: string }) {
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

function ChatPhaseView({
  phase,
  workspaceId,
  acting,
  connectError,
  onRetryLoad,
  onResume,
  onRetryConnect,
}: {
  phase: ChatPhase;
  workspaceId: string;
  acting: boolean;
  connectError: string | null;
  onRetryLoad: () => void;
  onResume: () => void;
  onRetryConnect: () => void;
}) {
  switch (phase.kind) {
    case "chat":
      return (
        <TaskConversation
          serverId={phase.serverId}
          agentId={phase.agentId}
          workspaceId={workspaceId}
        />
      );
    case "not_found":
      return <NotFound />;
    case "error":
      return (
        <EmptyState title={phase.message}>
          <RetryButton label="Try again" onPress={onRetryLoad} />
        </EmptyState>
      );
    case "paused":
      return (
        <EmptyState title={phase.label} hint="Starting it again restores where it left off.">
          {phase.canResume ? <StartButton acting={acting} onPress={onResume} /> : null}
        </EmptyState>
      );
    case "closed":
      return <EmptyState title={phase.label} />;
    case "starting":
      return (
        <EmptyState
          title={phase.label}
          hint="The task's machine is starting. This page opens the chat when it's ready."
        />
      );
    case "waiting_agent":
      return <EmptyState title="Waiting for the agent to start…" />;
    case "loading":
      return <EmptyState title="Loading…" />;
    case "connect":
    case "connecting":
      return (
        <View style={styles.connecting}>
          <EmptyState title="Connecting…" />
          {connectError ? (
            <Banner tone="error">
              {connectError}
              <RetryButton label="Try again" onPress={onRetryConnect} />
            </Banner>
          ) : null}
        </View>
      );
  }
}

function RetryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Button variant="outline" size="sm" onPress={onPress}>
      {label}
    </Button>
  );
}

function StartButton({ acting, onPress }: { acting: boolean; onPress: () => void }) {
  return (
    <Button variant="default" loading={acting} onPress={onPress} testID="jarvis3-chat-resume">
      Start
    </Button>
  );
}

function NotFound() {
  const router = useRouter();
  const back = useCallback(() => router.replace("/tasks" as Href), [router]);
  return (
    <EmptyState title="This task doesn't exist, or isn't yours.">
      <Button variant="outline" onPress={back} testID="jarvis3-back-to-tasks">
        Back to tasks
      </Button>
    </EmptyState>
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

function TaskConversation({
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
    <View style={styles.chat} testID="jarvis3-chat">
      <PaneProvider value={pane}>
        <PaneFocusProvider value={focus}>
          <AgentConversationPanel />
        </PaneFocusProvider>
      </PaneProvider>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  chat: {
    flex: 1,
    minHeight: 320,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  connecting: {
    gap: theme.spacing[3],
  },
}));
