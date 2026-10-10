// A task's channel and wakeups: what the task's agent posted for its owner (reports, the result of
// a scheduled run), newest first, and the wakeups it armed, with Cancel. Opening it marks the posts
// read for the task's owner. An admin opening someone else's channel (from the Users page) gets it
// read-only: no Cancel, no Open chat, no Wake, and nothing is marked read. The owner can also
// wake the task at a time ("Wake this task at…", POST /api/tasks/:id/wakeups).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import type { ChannelPostView, TaskView, WakeupView } from "../api-types";
import { jarvis3Api, taskExtrasStore } from "../client";
import { useAccount, useTaskExtras } from "../hooks";
import {
  checkWakeForm,
  describeWakeupWhen,
  deviceTimeZone,
  openWakeForm,
  type WakeForm,
  wakeupStateLabel,
  wakeupsOrdered,
} from "../schedules";
import { messageOf } from "../stores";
import { Banner, CenteredDialog, EmptyState, Jarvis3Frame, StatusPill } from "../ui";
import { formatWhen } from "./format";

/** The owner may wake a task that hasn't ended. */
function wakeable(task: TaskView | null, readOnly: boolean): boolean {
  if (task === null || readOnly) return false;
  return task.state !== "archived" && task.state !== "destroying" && task.state !== "failed";
}

export function TaskChannelScreen({ taskId }: { taskId: string }) {
  const router = useRouter();
  const extras = useTaskExtras();
  const posts = extras.posts[taskId];
  const wakeups = extras.wakeups[taskId];
  const [task, setTask] = useState<TaskView | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<WakeupView | null>(null);
  const [waking, setWaking] = useState(false);
  const myId = useAccount().me?.user.id ?? null;
  // Someone else's task: an admin reading it from the Users page.
  const readOnly = task !== null && task.userId !== myId;

  useEffect(() => {
    jarvis3Api
      .getTask(taskId)
      .then((loaded) => {
        setTask(loaded);
        // Only the owner's opening marks posts read.
        void taskExtrasStore.loadPosts(taskId, { markRead: loaded.userId === myId });
        return undefined;
      })
      .catch((error: unknown) => setTaskError(messageOf(error)));
    void taskExtrasStore.loadWakeups(taskId);
  }, [taskId, myId]);

  const openChat = useCallback(
    () => router.push(`/tasks/${encodeURIComponent(taskId)}` as Href),
    [router, taskId],
  );
  const canOpenChat =
    task !== null && !readOnly && task.state !== "archived" && task.state !== "destroying";
  const actions = useMemo(
    () =>
      canOpenChat ? (
        <Button variant="outline" size="sm" onPress={openChat} testID="jarvis3-channel-open-chat">
          Open chat
        </Button>
      ) : null,
    [canOpenChat, openChat],
  );
  const closeDialog = useCallback(() => setCancelling(null), []);
  const openWake = useCallback(() => setWaking(true), []);
  const closeWake = useCallback(() => setWaking(false), []);
  const canWake = wakeable(task, readOnly);

  if (taskError && !posts?.posts.length) {
    return (
      <Jarvis3Frame title="Channel" testID="jarvis3-channel">
        <EmptyState title="This task doesn't exist, or isn't yours." hint={taskError} />
      </Jarvis3Frame>
    );
  }

  return (
    <Jarvis3Frame
      title={task ? `Channel: ${task.title}` : "Channel"}
      testID="jarvis3-channel"
      actions={actions}
    >
      {readOnly ? (
        <Banner tone="info" testID="jarvis3-channel-read-only">
          {"Read only: this is another person's task. Opening it doesn't mark their posts read."}
        </Banner>
      ) : null}
      <WakeupsSection
        entry={wakeups}
        readOnly={readOnly}
        cancelling={extras.cancelling}
        cancelErrors={extras.cancelErrors}
        onCancel={setCancelling}
        onWake={canWake ? openWake : null}
      />
      <SettingsSection title="Posts">
        {posts?.error ? <Banner tone="error">{posts.error}</Banner> : null}
        <PostsBody loaded={posts?.loaded ?? false} posts={posts?.posts ?? []} />
      </SettingsSection>
      <WakeDialog taskId={taskId} visible={waking} onClose={closeWake} />
      <CancelWakeupDialog
        wakeup={cancelling}
        busy={cancelling ? extras.cancelling[cancelling.id] === true : false}
        onClose={closeDialog}
      />
    </Jarvis3Frame>
  );
}

function CancelWakeupDialog({
  wakeup,
  busy,
  onClose,
}: {
  wakeup: WakeupView | null;
  busy: boolean;
  onClose: () => void;
}) {
  const confirm = useCallback(() => {
    if (!wakeup) return;
    const run = async () => {
      await taskExtrasStore.cancelWakeup(wakeup);
      onClose();
    };
    void run();
  }, [wakeup, onClose]);
  return (
    <CenteredDialog
      visible={wakeup !== null}
      title="Cancel this wakeup?"
      message={`The task won't be woken for "${wakeup?.name ?? ""}". The agent can arm it again.`}
      confirmLabel="Cancel wakeup"
      cancelLabel="Keep"
      destructive
      busy={busy}
      onCancel={onClose}
      onConfirm={confirm}
      testID="jarvis3-wakeup-cancel-dialog"
    />
  );
}

/** "Wake this task at…": a date and time on the device's clock, and an optional message. */
function WakeDialog({
  taskId,
  visible,
  onClose,
}: {
  taskId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState<WakeForm>(() => openWakeForm(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setForm(openWakeForm(new Date()));
    setError(null);
    setBusy(false);
  }, [visible]);
  const setDate = useCallback((date: string) => setForm((f) => ({ ...f, date })), []);
  const setTime = useCallback((time: string) => setForm((f) => ({ ...f, time })), []);
  const setMessage = useCallback((message: string) => setForm((f) => ({ ...f, message })), []);
  const confirm = useCallback(() => {
    const checked = checkWakeForm(form, new Date());
    if ("error" in checked) {
      setError(checked.error);
      return;
    }
    const run = async () => {
      setBusy(true);
      setError(null);
      const refusal = await taskExtrasStore.armWakeup(taskId, checked.request);
      setBusy(false);
      if (refusal) setError(refusal);
      else onClose();
    };
    void run();
  }, [form, taskId, onClose]);
  const zone = deviceTimeZone();
  return (
    <CenteredDialog
      visible={visible}
      title="Wake this task at…"
      message={`The task gets your message then, and starts again if it is paused. Your time${zone ? ` (${zone})` : ""}.`}
      confirmLabel="Wake then"
      busy={busy}
      onCancel={onClose}
      onConfirm={confirm}
      testID="jarvis3-wake-dialog"
    >
      {visible ? (
        <View style={styles.wakeForm}>
          <View style={styles.wakeRow}>
            <View style={styles.wakeField}>
              <Text style={styles.wakeLabel}>Date</Text>
              <FormTextInput
                initialValue={form.date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
                accessibilityLabel="Date"
                size="sm"
                testID="jarvis3-wake-date"
              />
            </View>
            <View style={styles.wakeField}>
              <Text style={styles.wakeLabel}>Time</Text>
              <FormTextInput
                initialValue={form.time}
                onChangeText={setTime}
                placeholder="HH:MM"
                accessibilityLabel="Time"
                size="sm"
                testID="jarvis3-wake-time"
              />
            </View>
          </View>
          <Text style={styles.wakeLabel}>Message for the agent (optional)</Text>
          <FormTextInput
            initialValue=""
            onChangeText={setMessage}
            placeholder="Check whether the supplier replied."
            accessibilityLabel="Message for the agent"
            multiline
            size="sm"
            testID="jarvis3-wake-message"
          />
          {error ? (
            <Text style={styles.wakeupError} testID="jarvis3-wake-error">
              {error}
            </Text>
          ) : null}
        </View>
      ) : null}
    </CenteredDialog>
  );
}

function PostsBody({ loaded, posts }: { loaded: boolean; posts: ChannelPostView[] }) {
  if (!loaded) return <EmptyState title="Loading…" />;
  if (posts.length === 0) {
    return (
      <EmptyState
        title="No posts yet"
        hint="The agent posts results here (a report, the outcome of a scheduled run), and you get a notice."
      />
    );
  }
  return (
    <View style={styles.posts} testID="jarvis3-channel-posts">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </View>
  );
}

function PostCard({ post }: { post: ChannelPostView }) {
  return (
    <View style={styles.post} testID={`jarvis3-post-${post.id}`}>
      <View style={styles.postHeader}>
        <Text style={styles.postTitle} numberOfLines={2}>
          {post.title}
        </Text>
        {post.read ? null : <StatusPill tone="busy" label="New" />}
      </View>
      <Text style={styles.postWhen}>{formatWhen(post.createdAt)}</Text>
      <View style={styles.postBody}>
        <MarkdownRenderer text={post.text} enableHtmlish={false} />
      </View>
    </View>
  );
}

function WakeupsSection({
  entry,
  readOnly,
  cancelling,
  cancelErrors,
  onCancel,
  onWake,
}: {
  entry: { loaded: boolean; wakeups: WakeupView[]; error: string | null } | undefined;
  readOnly: boolean;
  cancelling: Record<string, true>;
  cancelErrors: Record<string, string>;
  onCancel: (wakeup: WakeupView) => void;
  /** null: the task can't be woken from here (someone else's, or ended). */
  onWake: (() => void) | null;
}) {
  const wakeups = entry?.wakeups;
  const ordered = useMemo(() => wakeupsOrdered(wakeups ?? []), [wakeups]);
  const wake = useMemo(
    () =>
      onWake ? (
        <Button variant="outline" size="sm" onPress={onWake} testID="jarvis3-wake-open">
          Wake this task at…
        </Button>
      ) : null,
    [onWake],
  );
  if (!entry?.loaded) return null;
  const error = entry.error;
  return (
    <SettingsSection title="Wakeups" trailing={wake}>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {ordered.length === 0 ? (
        <SettingsCard>
          <SettingsRow
            label="No wakeups"
            hint="The agent can ask to be woken later (at a time, on a repeat, or when a page changes), and you can wake it at a time. The task starts again by itself if it was paused."
          />
        </SettingsCard>
      ) : (
        <SettingsCard testID="jarvis3-wakeups">
          {ordered.map((wakeup) => (
            <WakeupRow
              key={wakeup.id}
              wakeup={wakeup}
              busy={cancelling[wakeup.id] === true}
              error={cancelErrors[wakeup.id] ?? null}
              onCancel={readOnly ? null : onCancel}
            />
          ))}
        </SettingsCard>
      )}
    </SettingsSection>
  );
}

function WakeupRow({
  wakeup,
  busy,
  error,
  onCancel,
}: {
  wakeup: WakeupView;
  busy: boolean;
  error: string | null;
  /** null: read-only, no Cancel. */
  onCancel: ((wakeup: WakeupView) => void) | null;
}) {
  const state = wakeupStateLabel(wakeup);
  const pill = useMemo(() => <StatusPill tone={state.tone} label={state.label} />, [state]);
  const cancel = useCallback(() => onCancel?.(wakeup), [onCancel, wakeup]);
  const hint = useMemo(
    () => (
      <View style={styles.wakeupHint}>
        <Text style={styles.wakeupWhen}>{describeWakeupWhen(wakeup, formatWhen)}</Text>
        <Text style={styles.wakeupPrompt} numberOfLines={3}>
          {wakeup.prompt}
        </Text>
        {wakeup.lastError ? <Text style={styles.wakeupError}>{wakeup.lastError}</Text> : null}
      </View>
    ),
    [wakeup],
  );
  return (
    <SettingsRow
      label={wakeup.setBy === "owner" ? `${wakeup.name} (set by you)` : wakeup.name}
      labelAccessory={pill}
      hint={hint}
      error={error ?? undefined}
      testID={`jarvis3-wakeup-${wakeup.id}`}
    >
      {wakeup.state === "armed" && onCancel ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={cancel}
          loading={busy}
          testID={`jarvis3-wakeup-cancel-${wakeup.id}`}
        >
          Cancel
        </Button>
      ) : null}
    </SettingsRow>
  );
}

const styles = StyleSheet.create((theme) => ({
  posts: {
    gap: theme.spacing[3],
  },
  post: {
    gap: theme.spacing[1],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  postHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  postTitle: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  postWhen: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  postBody: {
    marginTop: theme.spacing[2],
  },
  wakeupHint: {
    gap: theme.spacing[1],
  },
  wakeupWhen: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  wakeupPrompt: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  wakeForm: {
    gap: theme.spacing[2],
  },
  wakeRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  wakeField: {
    flex: 1,
    gap: theme.spacing[1],
  },
  wakeLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  wakeupError: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
}));
