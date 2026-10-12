// Notices from the instance (a cap or the budget paused a task, a task failed, access removed,
// an approval waits or was decided), newest first. Opening the screen marks them read, which
// clears the count in the navigation.
import { useCallback, useEffect, useMemo } from "react";
import { useRouter, type Href } from "expo-router";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import type { NoticeView } from "../api-types";
import { noticesStore } from "../client";
import { useAccount, useNotices } from "../hooks";
import { Banner, EmptyState, Jarvis3Frame, StatusPill } from "../ui";
import { noticeTarget } from "../schedules";
import { formatWhen } from "./format";

export function NoticesScreen() {
  const notices = useNotices();
  const account = useAccount();
  const router = useRouter();
  const openSettings = useCallback(() => router.push("/me/notifications" as Href), [router]);
  // Push settings only on a server that pushes (features.push)
  const hasPush = Boolean(account.me?.features?.push);
  const actions = useMemo(
    () =>
      hasPush ? (
        <Button variant="outline" size="sm" onPress={openSettings} testID="jarvis3-push-settings">
          Notification settings
        </Button>
      ) : undefined,
    [hasPush, openSettings],
  );

  useEffect(() => {
    void noticesStore.load();
  }, []);

  return (
    <Jarvis3Frame title="Notices" actions={actions} testID="jarvis3-notices">
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
        hint="Jarvis tells you here when a limit stops a chat or a chat can't start."
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
  const target = noticeTarget(notice);
  const href = target?.href ?? null;
  const open = useCallback(() => {
    if (href) router.push(href as Href);
  }, [router, href]);
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
      {target ? (
        <Button variant="ghost" size="sm" onPress={open}>
          {target.label}
        </Button>
      ) : null}
    </SettingsRow>
  );
}
