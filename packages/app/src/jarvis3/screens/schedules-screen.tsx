// Scheduled tasks: the caller's schedules (a prompt that runs as a new task on a repeat, in a time
// zone), with each one's next run and last outcome, an On/Off switch and Run now.
import { useCallback, useEffect, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ScheduleView } from "../api-types";
import { schedulesStore } from "../client";
import { useSchedules } from "../hooks";
import { describeRepeat, runResultLabel, scheduleStatus, schedulesOrdered } from "../schedules";
import { Banner, EmptyState, Jarvis3Frame, StatusPill } from "../ui";
import { formatWhen } from "./format";

export function SchedulesScreen() {
  const router = useRouter();
  const schedules = useSchedules();
  const ordered = useMemo(() => schedulesOrdered(schedules.schedules), [schedules.schedules]);

  useEffect(() => {
    void schedulesStore.loadList();
  }, []);

  const openNew = useCallback(() => router.push("/scheduled/new" as Href), [router]);
  const actions = useMemo(
    () => (
      <Button variant="default" size="sm" onPress={openNew} testID="jarvis3-new-schedule">
        New schedule
      </Button>
    ),
    [openNew],
  );

  return (
    <Jarvis3Frame title="Schedules" testID="jarvis3-schedules" actions={actions}>
      {schedules.error ? <Banner tone="error">{schedules.error}</Banner> : null}
      <SchedulesBody loaded={schedules.loaded} schedules={ordered} />
    </Jarvis3Frame>
  );
}

function SchedulesBody({ loaded, schedules }: { loaded: boolean; schedules: ScheduleView[] }) {
  if (!loaded) return <EmptyState title="Loading…" />;
  if (schedules.length === 0) {
    return (
      <EmptyState
        title="No schedules yet"
        hint="A schedule runs a prompt as a new task at the times you choose, for example a report every Monday at 09:00. The agent posts the result to the task's channel."
      />
    );
  }
  return (
    <SettingsCard testID="jarvis3-schedule-list">
      {schedules.map((schedule) => (
        <ScheduleRow key={schedule.id} schedule={schedule} />
      ))}
    </SettingsCard>
  );
}

function ScheduleRow({ schedule }: { schedule: ScheduleView }) {
  const router = useRouter();
  const busy = useSchedules().busy[schedule.id];
  const error = useSchedules().actionErrors[schedule.id];
  const lastRunNow = useSchedules().lastRunNow[schedule.id];
  const status = scheduleStatus(schedule, formatWhen);
  const last = schedule.lastRun;
  const open = useCallback(
    () => router.push(`/scheduled/${encodeURIComponent(schedule.id)}` as Href),
    [router, schedule.id],
  );
  const toggle = useCallback(
    (enabled: boolean) => void schedulesStore.setEnabled(schedule.id, enabled),
    [schedule.id],
  );
  const runNow = useCallback(() => void schedulesStore.runNow(schedule.id), [schedule.id]);
  const startedTask = lastRunNow?.task ?? null;
  const openTask = useCallback(() => {
    if (startedTask) router.push(`/tasks/${encodeURIComponent(startedTask.id)}` as Href);
  }, [router, startedTask]);
  return (
    <View style={styles.row} testID={`jarvis3-schedule-${schedule.id}`}>
      <View style={styles.top}>
        <Pressable
          style={styles.main}
          onPress={open}
          accessibilityRole="link"
          accessibilityLabel={schedule.title}
          testID={`jarvis3-schedule-open-${schedule.id}`}
        >
          <Text style={styles.title} numberOfLines={2}>
            {schedule.title}
          </Text>
          <Text style={styles.meta}>
            {describeRepeat(schedule.cron)} · {schedule.timeZone}
          </Text>
          <StatusPill
            tone={status.tone}
            label={status.label}
            testID={`jarvis3-schedule-status-${schedule.id}`}
          />
          {last ? (
            <Text style={styles.meta} numberOfLines={2}>
              Last run {formatWhen(last.ranAt)}: {runResultLabel(last).label}
            </Text>
          ) : null}
        </Pressable>
        <View style={styles.actions}>
          <Switch
            value={schedule.enabled}
            onValueChange={toggle}
            disabled={busy !== undefined}
            accessibilityLabel={`${schedule.title}: on`}
            testID={`jarvis3-schedule-toggle-${schedule.id}`}
          />
          <Button
            variant="outline"
            size="sm"
            onPress={runNow}
            loading={busy === "run"}
            disabled={busy !== undefined}
            testID={`jarvis3-schedule-run-${schedule.id}`}
          >
            Run now
          </Button>
        </View>
      </View>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {lastRunNow && !error ? (
        <Banner tone={startedTask ? "ok" : "info"} testID={`jarvis3-schedule-ran-${schedule.id}`}>
          {startedTask ? "Started a new task." : runResultLabel(lastRunNow.run).label}
          {startedTask ? (
            <Button variant="outline" size="sm" onPress={openTask}>
              Open task
            </Button>
          ) : null}
        </Banner>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  top: {
    flexDirection: { xs: "column", md: "row" },
    alignItems: { xs: "stretch", md: "center" },
    gap: theme.spacing[3],
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
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    justifyContent: { xs: "flex-start", md: "flex-end" },
  },
}));
