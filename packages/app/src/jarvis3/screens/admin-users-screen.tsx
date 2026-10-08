// Admin: every user's monthly limits (model spend and machine hours) and this month's use.
// Shown only to admins; the server refuses the routes to anyone else (404).
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsInput, SettingsRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import type { UserDetail } from "../api-types";
import { jarvis3Api } from "../client";
import { useAccount } from "../hooks";
import { formatLimit, parseLimitInput } from "../plan";
import { messageOf } from "../stores";
import { Banner, EmptyState, Jarvis3Frame } from "../ui";

export function AdminUsersScreen() {
  const account = useAccount();
  const isAdmin = account.me?.user.isAdmin === true;
  const [users, setUsers] = useState<UserDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

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
          {users.map((detail) =>
            editing === detail.user.id ? (
              <LimitsEditor key={detail.user.id} detail={detail} onDone={done} />
            ) : (
              <UserRow key={detail.user.id} detail={detail} onEdit={setEditing} />
            ),
          )}
        </SettingsCard>
      ) : (
        <EmptyState title="Loading…" />
      )}
    </Jarvis3Frame>
  );
}

function userLabel(detail: UserDetail): string {
  const { user } = detail;
  const status = user.status === "active" ? "" : ` · ${user.status}`;
  return `${user.name || user.email} · ${user.role}${status}`;
}

function describe(detail: UserDetail): string {
  const { limits, usage } = detail;
  const own = " (set for this user)";
  const model = `Model spend ${formatLimit(limits.openrouterMonthlyUsd, "usd")}${limits.openrouterOverride ? own : ""}`;
  const hours = `machine time ${usage.machineHours.toFixed(1)} h of ${formatLimit(limits.machineHoursPerMonth, "hours")}${limits.machineHoursOverride ? own : ""}`;
  return `${model}; ${hours} in ${usage.month}.`;
}

function UserRow({ detail, onEdit }: { detail: UserDetail; onEdit: (userId: string) => void }) {
  const edit = useCallback(() => onEdit(detail.user.id), [onEdit, detail.user.id]);
  return (
    <SettingsRow
      label={userLabel(detail)}
      hint={describe(detail)}
      testID={`jarvis3-user-${detail.user.id}`}
    >
      <Button variant="ghost" size="sm" onPress={edit}>
        Limits
      </Button>
    </SettingsRow>
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
  buttons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
