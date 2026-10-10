// Admin: every user's monthly limits (model spend and machine hours) and this month's use, with
// the machine-hour cap state; each user's tasks (archive downloads) and personal layer, kept after
// offboarding; and everyone's "Suggest for everyone" pull requests.
// Shown only to admins; the server refuses the routes to anyone else (404).
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsInput, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/utils/open-external-url";
import type { PersonalLayerView, TaskView, UserDetail } from "../api-types";
import { jarvis3Api } from "../client";
import { useAccount } from "../hooks";
import { canDownloadArchive, describeUsage, parseLimitInput, presentTask } from "../plan";
import { messageOf } from "../stores";
import { Banner, EmptyState, Jarvis3Frame, StatusPill } from "../ui";
import { SuggestionsCard, useSuggestions } from "./suggestions";

export function AdminUsersScreen() {
  const account = useAccount();
  const isAdmin = account.me?.user.isAdmin === true;
  const [users, setUsers] = useState<UserDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const suggestions = useSuggestions(isAdmin && account.me?.features?.suggestions === true, {
    all: true,
  });
  const toggleDetails = useCallback(
    (userId: string) => setDetails((current) => (current === userId ? null : userId)),
    [],
  );

  useEffect(() => {
    if (!isAdmin) return;
    const run = async () => {
      try {
        setUsers((await jarvis3Api.listUsers()).users);
        setError(null);
      } catch (e) {
        setError(messageOf(e));
      }
    };
    void run();
  }, [isAdmin]);

  const done = useCallback((updated: UserDetail | null) => {
    setEditing(null);
    if (!updated) return;
    setUsers((list) => {
      if (!list) return list;
      return list.map((entry) => (entry.user.id === updated.user.id ? updated : entry));
    });
  }, []);

  if (!isAdmin) {
    return (
      <Jarvis3Frame title="Users">
        <EmptyState title="Only admins can see this page." />
      </Jarvis3Frame>
    );
  }

  return (
    <Jarvis3Frame title="Users" testID="jarvis3-admin-users">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {users ? (
        <SettingsCard testID="jarvis3-users">
          {users.map((detail) => (
            <View key={detail.user.id}>
              {editing === detail.user.id ? (
                <LimitsEditor detail={detail} onDone={done} />
              ) : (
                <UserRow detail={detail} onEdit={setEditing} onDetails={toggleDetails} />
              )}
              {details === detail.user.id ? <UserRecords userId={detail.user.id} /> : null}
            </View>
          ))}
        </SettingsCard>
      ) : (
        <EmptyState title="Loading…" />
      )}
      {suggestions.list ? (
        <SettingsSection title="Suggested for everyone">
          {suggestions.error ? <Banner tone="error">{suggestions.error}</Banner> : null}
          <SuggestionsCard list={suggestions.list} showOwner testID="jarvis3-all-suggestions" />
        </SettingsSection>
      ) : null}
    </Jarvis3Frame>
  );
}

function userLabel(detail: UserDetail): string {
  const { user } = detail;
  const status = user.status === "active" ? "" : ` · ${user.status}`;
  return `${user.name || user.email} · ${user.role}${status}`;
}

function UserRow({
  detail,
  onEdit,
  onDetails,
}: {
  detail: UserDetail;
  onEdit: (userId: string) => void;
  onDetails: (userId: string) => void;
}) {
  const edit = useCallback(() => onEdit(detail.user.id), [onEdit, detail.user.id]);
  const toggle = useCallback(() => onDetails(detail.user.id), [onDetails, detail.user.id]);
  return (
    <SettingsRow
      label={userLabel(detail)}
      hint={describeUsage(detail)}
      testID={`jarvis3-user-${detail.user.id}`}
    >
      <View style={styles.inlineButtons}>
        {detail.usage.machineHoursCapReached ? (
          <StatusPill tone="error" label="At cap" testID={`jarvis3-user-cap-${detail.user.id}`} />
        ) : null}
        <Button variant="ghost" size="sm" onPress={toggle}>
          Tasks & layer
        </Button>
        <Button variant="ghost" size="sm" onPress={edit}>
          Limits
        </Button>
      </View>
    </SettingsRow>
  );
}

/** A user's tasks (archived ones downloadable) and personal layer, kept after offboarding. */
function UserRecords({ userId }: { userId: string }) {
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [layer, setLayer] = useState<PersonalLayerView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const [taskList, personal] = await Promise.all([
          jarvis3Api.listUserTasks(userId),
          jarvis3Api.getUserLayer(userId),
        ]);
        setTasks(taskList.tasks);
        setLayer(personal);
      } catch (e) {
        setError(messageOf(e));
      }
    };
    void run();
  }, [userId]);

  const download = useCallback((taskId: string) => {
    const run = async () => {
      try {
        await openExternalUrl((await jarvis3Api.archiveLink(taskId)).url);
      } catch (e) {
        setError(messageOf(e));
      }
    };
    void run();
  }, []);

  return (
    <View style={styles.records} testID={`jarvis3-user-records-${userId}`}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {tasks ? (
        <>
          <Text style={styles.subhead}>Tasks</Text>
          {tasks.length === 0 ? <Text style={styles.hint}>No tasks.</Text> : null}
          {tasks.map((task) => (
            <TaskRecord key={task.id} task={task} onDownload={download} />
          ))}
        </>
      ) : null}
      {layer ? (
        <>
          <Text style={styles.subhead}>Personal layer</Text>
          <Text style={styles.hint}>{layerSummary(layer)}</Text>
          {layer.instructions.trim() ? (
            <Text style={styles.body} numberOfLines={6}>
              {layer.instructions}
            </Text>
          ) : null}
          {layer.notes.map((note) => (
            <Text key={note.id} style={styles.body}>
              {`• ${note.text}`}
            </Text>
          ))}
        </>
      ) : null}
      {!tasks && !layer && !error ? <Text style={styles.hint}>Loading…</Text> : null}
    </View>
  );
}

function layerSummary(layer: PersonalLayerView): string {
  const skills = layer.skills.map((skill) => skill.name).join(", ");
  return [
    layer.instructions.trim() ? "Has instructions" : "No instructions",
    skills ? `skills: ${skills}` : "no skills",
    `${layer.notes.length} note${layer.notes.length === 1 ? "" : "s"}`,
    `${layer.versions.length} archived version${layer.versions.length === 1 ? "" : "s"}`,
  ].join("; ");
}

function TaskRecord({
  task,
  onDownload,
}: {
  task: TaskView;
  onDownload: (taskId: string) => void;
}) {
  const view = presentTask(task);
  const press = useCallback(() => onDownload(task.id), [onDownload, task.id]);
  return (
    <View style={styles.taskRow}>
      <View style={styles.taskText}>
        <Text style={styles.body} numberOfLines={1}>
          {task.title}
        </Text>
        <Text style={styles.hint}>{task.error ? `${view.label} · ${task.error}` : view.label}</Text>
      </View>
      {canDownloadArchive(task) ? (
        <Button variant="ghost" size="sm" onPress={press}>
          Download archive
        </Button>
      ) : null}
    </View>
  );
}

function overrideText(value: number | null, override: boolean): string {
  return override && value !== null ? String(value) : "";
}

function LimitsEditor({
  detail,
  onDone,
}: {
  detail: UserDetail;
  onDone: (updated: UserDetail | null) => void;
}) {
  const { limits } = detail;
  const [usd, setUsd] = useState(
    overrideText(limits.openrouterMonthlyUsd, limits.openrouterOverride),
  );
  const [hours, setHours] = useState(
    overrideText(limits.machineHoursPerMonth, limits.machineHoursOverride),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cancel = useCallback(() => onDone(null), [onDone]);
  const save = useCallback(() => {
    const a = parseLimitInput(usd);
    if (!a.ok) {
      setError(a.error);
      return;
    }
    const b = parseLimitInput(hours);
    if (!b.ok) {
      setError(b.error);
      return;
    }
    const run = async () => {
      setSaving(true);
      try {
        onDone(
          await jarvis3Api.setLimits(detail.user.id, {
            openrouterMonthlyUsd: a.value,
            machineHoursPerMonth: b.value,
          }),
        );
      } catch (e) {
        setError(messageOf(e));
        setSaving(false);
      }
    };
    void run();
  }, [usd, hours, detail.user.id, onDone]);

  return (
    <View style={styles.editor}>
      <Text style={styles.name}>{detail.user.name || detail.user.email}</Text>
      <Text style={styles.hint}>Leave a field empty to use the role&apos;s default.</Text>
      <SettingsInput
        label="Model spend per month (USD)"
        initialValue={usd}
        onChangeText={setUsd}
        placeholder="Role default"
      />
      <SettingsInput
        label="Machine hours per month"
        initialValue={hours}
        onChangeText={setHours}
        placeholder="Role default"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.buttons}>
        <Button variant="ghost" size="sm" onPress={cancel}>
          Cancel
        </Button>
        <Button variant="default" size="sm" loading={saving} onPress={save}>
          Save
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  editor: {
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
  name: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  inlineButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  records: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[2],
  },
  subhead: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    marginTop: theme.spacing[2],
  },
  body: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  taskText: {
    flex: 1,
    minWidth: 0,
  },
  buttons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
