import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import type { TaskView } from "../api-types";
import { taskExtrasStore, tasksStore } from "../client";
import { useAccount, useTaskExtras, useTasks } from "../hooks";
import { myUsageRows, orderTasks, presentTask } from "../plan";
import { pruneTaskHosts } from "../task-host";
import { Banner, CenteredDialog, EmptyState, Jarvis3Frame, StatusPill } from "../ui";

type Pending = "resume" | "pause" | "delete";

const PENDING_LABEL: Record<Pending, string> = {
  resume: "Resuming…",
  pause: "Pausing…",
  delete: "Deleting…",
};

export function TaskListScreen() {
  const router = useRouter();
  const tasks = useTasks();
  const ordered = useMemo(() => orderTasks(tasks.tasks), [tasks.tasks]);
  const [deleting, setDeleting] = useState<TaskView | null>(null);

  useEffect(() => {
    tasksStore.activate();
    return () => tasksStore.deactivate();
  }, []);
  const schedulesOn = useAccount().me?.features?.schedules === true;
  useEffect(() => {
    if (schedulesOn) void taskExtrasStore.loadChannels();
  }, [schedulesOn]);

  // Forget the Paseo hosts of tasks that were deleted (a paused task keeps its host).
  const liveIds = useMemo(
    () =>
      tasks.tasks
        .filter((task) => task.state !== "archived")
        .map((task) => task.id)
        .join(","),
    [tasks.tasks],
  );
  useEffect(() => {
    if (!tasks.loaded || tasks.error) return;
    void pruneTaskHosts(new Set(liveIds ? liveIds.split(",") : []));
  }, [tasks.loaded, tasks.error, liveIds]);

  const openNew = useCallback(() => router.push("/tasks/new" as Href), [router]);
  const cancelDelete = useCallback(() => setDeleting(null), []);
  const confirmDelete = useCallback(() => {
    if (deleting) void tasksStore.remove(deleting.id);
    setDeleting(null);
  }, [deleting]);

  const actions = useMemo(
    () => (
      <Button variant="default" size="sm" onPress={openNew} testID="jarvis3-new-task">
        New task
      </Button>
    ),
    [openNew],
  );

  return (
    <Jarvis3Frame title="Tasks" testID="jarvis3-task-list" actions={actions}>
      {tasks.error ? <Banner tone="error">{tasks.error}</Banner> : null}
      <TaskListBody
        loaded={tasks.loaded}
        tasks={ordered}
        pending={tasks.pending}
        onDelete={setDeleting}
      />
      <MyUsage />
      <CenteredDialog
        visible={deleting !== null}
        title="Delete this task?"
        message={`"${deleting?.title ?? ""}" is archived for your organisation and its machine is removed. You can't open it again.`}
        confirmLabel="Delete"
        destructive
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
        testID="jarvis3-delete-dialog"
      />
    </Jarvis3Frame>
  );
}

function TaskListBody({
  loaded,
  tasks,
  pending,
  onDelete,
}: {
  loaded: boolean;
  tasks: TaskView[];
  pending: Record<string, Pending>;
  onDelete: (task: TaskView) => void;
}) {
  if (!loaded) return <EmptyState title="Loading…" />;
  if (tasks.length === 0) {
    return (
      <EmptyState
        title="No tasks yet"
        hint="Press New task and describe what you need. The agent works on it in its own machine."
      />
    );
  }
  return (
    <SettingsCard testID="jarvis3-tasks">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} pending={pending[task.id] ?? null} onDelete={onDelete} />
      ))}
    </SettingsCard>
  );
}

function TaskRow({
  task,
  pending,
  onDelete,
}: {
  task: TaskView;
  pending: Pending | null;
  onDelete: (task: TaskView) => void;
}) {
  const router = useRouter();
  const view = presentTask(task);
  const label = pending ? PENDING_LABEL[pending] : view.label;
  const openable = task.state !== "archived" && task.state !== "destroying";
  const deletable = openable && task.busy === null;
  const open = useCallback(
    () => router.push(`/tasks/${encodeURIComponent(task.id)}` as Href),
    [router, task.id],
  );
  const resume = useCallback(() => void tasksStore.resume(task.id), [task.id]);
  const pause = useCallback(() => void tasksStore.pause(task.id), [task.id]);
  const remove = useCallback(() => onDelete(task), [onDelete, task]);
  const channel = useTaskExtras().channels.find((c) => c.taskId === task.id) ?? null;
  const openChannel = useCallback(
    () => router.push(`/channels/${encodeURIComponent(task.id)}` as Href),
    [router, task.id],
  );
  return (
    <View style={styles.row} testID={`jarvis3-task-${task.id}`}>
      <Pressable
        style={styles.main}
        onPress={openable ? open : undefined}
        disabled={!openable}
        accessibilityRole="link"
        accessibilityLabel={task.title}
        testID={`jarvis3-task-open-${task.id}`}
      >
        <Text style={styles.title} numberOfLines={2}>
          {task.title}
        </Text>
        <StatusPill
          tone={pending ? "busy" : view.tone}
          label={label}
          testID={`jarvis3-task-state-${task.id}`}
        />
        {view.detail ? (
          <Text style={styles.detail} numberOfLines={3}>
            {view.detail}
          </Text>
        ) : null}
        {task.scheduleId ? <Text style={styles.meta}>From a schedule</Text> : null}
      </Pressable>
      <View style={styles.actions}>
        {channel ? (
          <Button
            variant={channel.unread > 0 ? "default" : "ghost"}
            size="sm"
            onPress={openChannel}
            testID={`jarvis3-task-channel-${task.id}`}
          >
            {channel.unread > 0 ? `${channel.unread} new posts` : "Channel"}
          </Button>
        ) : null}
        {view.canResume ? (
          <Button
            variant="outline"
            size="sm"
            onPress={resume}
            disabled={pending !== null}
            testID={`jarvis3-task-resume-${task.id}`}
          >
            Start
          </Button>
        ) : null}
        {view.canPause ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={pause}
            disabled={pending !== null}
            testID={`jarvis3-task-pause-${task.id}`}
          >
            Pause
          </Button>
        ) : null}
        {deletable ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={remove}
            disabled={pending !== null}
            testID={`jarvis3-task-delete-${task.id}`}
          >
            Delete
          </Button>
        ) : null}
      </View>
    </View>
  );
}

/** The user's own allowance and use this month (GET /api/me, refreshed with the account). */
function MyUsage() {
  const account = useAccount();
  const me = account.me;
  if (!me) return null;
  return (
    <SettingsSection title={`This month (${me.usage.month})`}>
      <SettingsCard testID="jarvis3-my-usage">
        {myUsageRows(me).map((row) => (
          <SettingsRow
            key={row.key}
            label={row.label}
            hint={row.value}
            testID={`jarvis3-my-usage-${row.key}`}
          >
            {row.capReached ? <StatusPill tone="error" label="At cap" /> : null}
          </SettingsRow>
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: { xs: "column", md: "row" },
    alignItems: { xs: "stretch", md: "center" },
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  main: {
    flex: 1,
    gap: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  detail: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[2],
    justifyContent: { xs: "flex-start", md: "flex-end" },
  },
}));
