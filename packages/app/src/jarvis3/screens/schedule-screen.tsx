// One schedule: the form (new or edit) with the server's preview of the next runs, Run now, Delete,
// and the run history. The form's logic is in ../schedules.ts (openScheduleForm, checkScheduleForm).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import {
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@/components/settings";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Button } from "@/components/ui/button";
import type { ScheduleDetail, SchedulePreview, ScheduleRunView } from "../api-types";
import { schedulesStore } from "../client";
import { useAccount, useSchedules } from "../hooks";
import {
  checkScheduleForm,
  deviceTimeZone,
  openScheduleForm,
  REPEAT_OPTIONS,
  type Repeat,
  type RepeatKind,
  runResultLabel,
  type ScheduleForm,
  scheduleStatus,
  WEEKDAYS,
} from "../schedules";
import { Banner, CenteredDialog, EmptyState, Jarvis3Frame, StatusPill } from "../ui";
import { formatWhen } from "./format";

const PREVIEW_DELAY_MS = 400;

/** `/scheduled/new` (scheduleId null) or `/scheduled/:id`. */
export function ScheduleScreen({ scheduleId }: { scheduleId: string | null }) {
  const schedules = useSchedules();
  const detail = scheduleId ? (schedules.byId[scheduleId] ?? null) : null;
  const loadError = scheduleId ? schedules.loadErrors[scheduleId] : undefined;

  useEffect(() => {
    if (scheduleId) void schedulesStore.load(scheduleId);
  }, [scheduleId]);

  if (!scheduleId) {
    return (
      <Jarvis3Frame title="New schedule" testID="jarvis3-schedule-new">
        <ScheduleFormView key="new" schedule={null} />
      </Jarvis3Frame>
    );
  }
  if (!detail) {
    return (
      <Jarvis3Frame title="Schedule" testID="jarvis3-schedule-page">
        {loadError ? (
          <EmptyState title="This schedule doesn't exist, or isn't yours." hint={loadError} />
        ) : (
          <EmptyState title="Loading…" />
        )}
      </Jarvis3Frame>
    );
  }
  return <ExistingSchedule detail={detail} />;
}

function ExistingSchedule({ detail }: { detail: ScheduleDetail }) {
  const router = useRouter();
  const schedules = useSchedules();
  const busy = schedules.busy[detail.id];
  const lastRunNow = schedules.lastRunNow[detail.id];
  const [deleting, setDeleting] = useState(false);
  const status = scheduleStatus(detail, formatWhen);

  const runNow = useCallback(() => void schedulesStore.runNow(detail.id), [detail.id]);
  const askDelete = useCallback(() => setDeleting(true), []);
  const cancelDelete = useCallback(() => setDeleting(false), []);
  const confirmDelete = useCallback(() => {
    const run = async () => {
      if (await schedulesStore.remove(detail.id)) router.replace("/scheduled" as Href);
      setDeleting(false);
    };
    void run();
  }, [detail.id, router]);
  const startedTask = lastRunNow?.task ?? null;
  const openTask = useCallback(() => {
    if (startedTask) router.push(`/tasks/${encodeURIComponent(startedTask.id)}` as Href);
  }, [router, startedTask]);

  const actions = useMemo(
    () => (
      <>
        <StatusPill tone={status.tone} label={status.label} testID="jarvis3-schedule-status" />
        <Button
          variant="outline"
          size="sm"
          onPress={runNow}
          loading={busy === "run"}
          disabled={busy !== undefined}
          testID="jarvis3-schedule-run"
        >
          Run now
        </Button>
      </>
    ),
    [status.tone, status.label, runNow, busy],
  );

  return (
    <Jarvis3Frame title={detail.title} testID="jarvis3-schedule-page" actions={actions}>
      {lastRunNow ? (
        <Banner tone={startedTask ? "ok" : "info"} testID="jarvis3-schedule-ran">
          {startedTask ? "Started a new task." : runResultLabel(lastRunNow.run).label}
          {startedTask ? (
            <Button variant="outline" size="sm" onPress={openTask}>
              Open task
            </Button>
          ) : null}
        </Banner>
      ) : null}
      <ScheduleFormView key={detail.id} schedule={detail} />
      <RunHistory runs={detail.runs} />
      <SettingsSection title="Delete">
        <SettingsCard>
          <SettingsRow
            label="Delete this schedule"
            hint="Its run history goes too. The tasks it started stay in your task list."
          >
            <Button
              variant="outline"
              size="sm"
              onPress={askDelete}
              disabled={busy !== undefined}
              testID="jarvis3-schedule-delete"
            >
              Delete
            </Button>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <CenteredDialog
        visible={deleting}
        title="Delete this schedule?"
        message={`"${detail.title}" stops running. The tasks it already started stay.`}
        confirmLabel="Delete"
        destructive
        busy={busy === "delete"}
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
        testID="jarvis3-schedule-delete-dialog"
      />
    </Jarvis3Frame>
  );
}

function RunHistory({ runs }: { runs: ScheduleRunView[] }) {
  return (
    <SettingsSection title="Runs">
      {runs.length === 0 ? (
        <SettingsCard>
          <SettingsRow label="No runs yet" hint="Each run starts a new task in your task list." />
        </SettingsCard>
      ) : (
        <SettingsCard testID="jarvis3-schedule-runs">
          {runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </SettingsCard>
      )}
    </SettingsSection>
  );
}

function RunRow({ run }: { run: ScheduleRunView }) {
  const router = useRouter();
  const result = runResultLabel(run);
  const taskId = run.taskId;
  const open = useCallback(() => {
    if (taskId) router.push(`/tasks/${encodeURIComponent(taskId)}` as Href);
  }, [router, taskId]);
  const pill = useMemo(() => <StatusPill tone={result.tone} label={result.label} />, [result]);
  const when = `${formatWhen(run.ranAt)}${run.manual ? " · started by hand" : ""}`;
  return (
    <SettingsRow
      label={when}
      hint={run.error ?? undefined}
      labelAccessory={pill}
      testID={`jarvis3-schedule-run-${run.id}`}
    >
      {taskId ? (
        <Button variant="ghost" size="sm" onPress={open}>
          Open task
        </Button>
      ) : null}
    </SettingsRow>
  );
}

// ---- the form ---------------------------------------------------------------------------------

function usePreview(cron: string | null, timeZone: string) {
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!cron || !timeZone.trim()) {
      setPreview(null);
      return undefined;
    }
    let live = true;
    const fetchPreview = async () => {
      try {
        const next = await schedulesStore.preview(cron, timeZone.trim());
        if (!live) return;
        setPreview(next);
        setFailed(null);
      } catch (error) {
        if (live) setFailed(error instanceof Error ? error.message : String(error));
      }
    };
    const timer = setTimeout(() => void fetchPreview(), PREVIEW_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [cron, timeZone]);
  return { preview, failed };
}

function ScheduleFormView({ schedule }: { schedule: ScheduleDetail | null }) {
  const router = useRouter();
  const account = useAccount();
  const schedules = useSchedules();
  const key = schedule?.id ?? "new";
  const busy = schedules.busy[key];
  const actionError = schedules.actionErrors[key];
  // One form per mount (the screens key it by schedule): background refreshes never reset input.
  const [form, setForm] = useState<ScheduleForm>(() =>
    openScheduleForm({
      schedule,
      defaultModel: account.models?.default ?? "",
      timeZone: deviceTimeZone() ?? "UTC",
    }),
  );
  const [saved, setSaved] = useState(false);
  const [tried, setTried] = useState(false);
  const check = checkScheduleForm(form);
  const { preview, failed } = usePreview(check.cron, form.timeZone);
  const serverRefusesTime = preview !== null && !preview.ok;

  const patch = useCallback((next: Partial<ScheduleForm>) => {
    setSaved(false);
    setForm((current) => ({ ...current, ...next }));
  }, []);
  const patchRepeat = useCallback((next: Partial<Repeat>) => {
    setSaved(false);
    setForm((current) => ({ ...current, repeat: { ...current.repeat, ...next } }));
  }, []);

  const setTitle = useCallback((title: string) => patch({ title }), [patch]);
  const setPrompt = useCallback((prompt: string) => patch({ prompt }), [patch]);
  const setModel = useCallback((model: string) => patch({ model }), [patch]);
  const setTimeZone = useCallback((timeZone: string) => patch({ timeZone }), [patch]);
  const setEnabled = useCallback((enabled: boolean) => patch({ enabled }), [patch]);
  const setKind = useCallback((kind: RepeatKind) => patchRepeat({ kind }), [patchRepeat]);
  const setTime = useCallback((time: string) => patchRepeat({ time }), [patchRepeat]);
  const setWeekday = useCallback((weekday: string) => patchRepeat({ weekday }), [patchRepeat]);
  const setCron = useCallback((cron: string) => patchRepeat({ cron }), [patchRepeat]);
  const setMinute = useCallback(
    (text: string) => patchRepeat({ minute: text.trim() === "" ? Number.NaN : Number(text) }),
    [patchRepeat],
  );
  const setMonthDay = useCallback(
    (text: string) => patchRepeat({ monthDay: text.trim() === "" ? Number.NaN : Number(text) }),
    [patchRepeat],
  );

  const submit = useCallback(() => {
    setTried(true);
    const request = check.request;
    if (!request || serverRefusesTime) return;
    const run = async () => {
      if (!schedule) {
        const created = await schedulesStore.create(request);
        if (created) router.replace(`/scheduled/${encodeURIComponent(created.id)}` as Href);
        return;
      }
      if (await schedulesStore.save(schedule.id, request)) setSaved(true);
    };
    void run();
  }, [check.request, serverRefusesTime, schedule, router]);
  const cancel = useCallback(() => router.replace("/scheduled" as Href), [router]);

  const modelOptions = useMemo(
    () => (account.models?.models ?? []).map((m) => ({ label: m.label, value: m.id })),
    [account.models],
  );
  const shownErrors = tried ? check.errors : {};

  return (
    <>
      <SettingsSection title="What to run">
        <SettingsCard>
          <SettingsInput
            label="Title"
            hint="Shown in your lists. Default: the prompt's first line."
            initialValue={form.title}
            onChangeText={setTitle}
            placeholder="Weekly supplier summary"
            error={shownErrors.title}
          />
        </SettingsCard>
        <SettingsTextAreaCard
          accessibilityLabel="Prompt"
          value={form.prompt}
          onChangeText={setPrompt}
          placeholder="What the agent should do at each run, as you would ask a colleague. It posts the result to the task's channel."
          testID="jarvis3-schedule-prompt"
          style={styles.prompt}
        />
        {shownErrors.prompt ? <Text style={styles.error}>{shownErrors.prompt}</Text> : null}
        {modelOptions.length > 0 ? (
          <SettingsCard>
            <SettingsSelect
              label="Model"
              value={form.model}
              options={modelOptions}
              onValueChange={setModel}
            />
          </SettingsCard>
        ) : null}
      </SettingsSection>
      <SettingsSection title="When">
        <SettingsCard>
          <SettingsSelect
            label="Repeat"
            value={form.repeat.kind}
            options={REPEAT_OPTIONS}
            onValueChange={setKind}
          />
          {form.repeat.kind === "weekly" ? (
            <SettingsSelect
              label="Day"
              value={form.repeat.weekday}
              options={WEEKDAYS}
              onValueChange={setWeekday}
            />
          ) : null}
          {form.repeat.kind === "monthly" ? (
            <SettingsInput
              label="Day of the month"
              hint="1 to 28."
              initialValue={String(form.repeat.monthDay)}
              onChangeText={setMonthDay}
            />
          ) : null}
          {form.repeat.kind === "hourly" ? (
            <SettingsInput
              label="Minutes past the hour"
              initialValue={String(form.repeat.minute)}
              onChangeText={setMinute}
            />
          ) : null}
          {form.repeat.kind === "custom" ? (
            <SettingsInput
              label="Cron expression"
              hint="minute hour day month weekday, for example 30 8 * * MON-FRI"
              initialValue={form.repeat.cron}
              onChangeText={setCron}
              placeholder="0 9 * * 1-5"
            />
          ) : null}
          {form.repeat.kind !== "hourly" && form.repeat.kind !== "custom" ? (
            <SettingsInput
              label="Time"
              hint="24-hour, HH:MM."
              initialValue={form.repeat.time}
              onChangeText={setTime}
              placeholder="09:00"
            />
          ) : null}
          <SettingsInput
            label="Time zone"
            hint="The schedule keeps this zone when you travel."
            initialValue={form.timeZone}
            onChangeText={setTimeZone}
            placeholder="Europe/London"
            error={shownErrors.timeZone}
          />
          <SettingsSwitch label="On" value={form.enabled} onValueChange={setEnabled} />
        </SettingsCard>
        <PreviewView repeatError={check.errors.repeat ?? null} preview={preview} failed={failed} />
      </SettingsSection>
      {actionError ? (
        <Banner tone="error" testID="jarvis3-schedule-error">
          {actionError}
        </Banner>
      ) : null}
      {saved ? (
        <Banner tone="ok" testID="jarvis3-schedule-saved">
          Saved.
        </Banner>
      ) : null}
      <View style={styles.buttons}>
        {schedule ? null : (
          <Button variant="ghost" onPress={cancel} testID="jarvis3-schedule-cancel">
            Cancel
          </Button>
        )}
        <Button
          variant="default"
          onPress={submit}
          loading={busy === "save"}
          disabled={busy !== undefined}
          testID="jarvis3-schedule-save"
        >
          {schedule ? "Save" : "Create schedule"}
        </Button>
      </View>
    </>
  );
}

function PreviewView({
  repeatError,
  preview,
  failed,
}: {
  repeatError: string | null;
  preview: SchedulePreview | null;
  failed: string | null;
}) {
  if (repeatError) {
    return (
      <Text style={styles.error} testID="jarvis3-schedule-preview-error">
        {repeatError}
      </Text>
    );
  }
  if (failed) return <Text style={styles.error}>{failed}</Text>;
  if (!preview) return null;
  if (!preview.ok) {
    return (
      <Text style={styles.error} testID="jarvis3-schedule-preview-error">
        {preview.error ?? "The instance refuses this time."}
      </Text>
    );
  }
  return (
    <View style={styles.preview} testID="jarvis3-schedule-preview">
      <Text style={styles.previewTitle}>Next runs</Text>
      {preview.next.map((entry) => (
        <Text key={entry.at} style={styles.previewLine}>
          {entry.local}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  prompt: {
    minHeight: 160,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    marginLeft: theme.spacing[1],
  },
  preview: {
    gap: theme.spacing[1],
    marginLeft: theme.spacing[1],
  },
  previewTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  previewLine: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  buttons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
