// Notices from the instance (a cap or the budget paused a task, a task failed, access removed),
// newest first. Opening the screen marks them read, which clears the count in the navigation.
import { useCallback, useEffect, useMemo } from "react";
import { useRouter, type Href } from "expo-router";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import type { NoticeView } from "../api-types";
import { noticesStore } from "../client";
import { useNotices } from "../hooks";
import { Banner, EmptyState, Jarvis3Frame, StatusPill } from "../ui";

export function NoticesScreen() {
  const notices = useNotices();

  useEffect(() => {
    void noticesStore.load();
  }, []);

  return (
    <Jarvis3Frame title="Notices" testID="jarvis3-notices">
      {notices.error ? <Banner tone="error">{notices.error}</Banner> : null}
      <NoticesBody loaded={notices.loaded} notices={notices.notices} />
    </Jarvis3Frame>
  );
}

function NoticesBody({ loaded, notices }: { loaded: boolean; notices: NoticeView[] }) {
  if (!loaded) return <EmptyState title="Loading…" />;
  if (notices.length === 0) {
    return (
      <EmptyState
        title="No notices"
        hint="The instance tells you here when a limit pauses a task or a task can't start."
      />
    );
  }
  return (
    <SettingsCard testID="jarvis3-notice-list">
      {notices.map((notice) => (
        <NoticeRow key={notice.id} notice={notice} />
      ))}
    </SettingsCard>
  );
}

function NoticeRow({ notice }: { notice: NoticeView }) {
  const router = useRouter();
  const taskId = notice.taskId;
  const open = useCallback(() => {
    if (taskId) router.push(`/tasks/${encodeURIComponent(taskId)}` as Href);
  }, [router, taskId]);
  const newPill = useMemo(
    () => (notice.read ? undefined : <StatusPill tone="busy" label="New" />),
    [notice.read],
  );
  return (
    <SettingsRow
      label={notice.text}
      hint={formatWhen(notice.createdAt)}
      labelAccessory={newPill}
      testID={`jarvis3-notice-${notice.id}`}
    >
      {taskId ? (
        <Button variant="ghost" size="sm" onPress={open}>
          Open task
        </Button>
      ) : null}
    </SettingsRow>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
