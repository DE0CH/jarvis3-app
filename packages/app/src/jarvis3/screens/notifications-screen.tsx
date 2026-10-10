// Push notification settings: this device on or off (the iOS app through APNs, a browser or a
// Home Screen web app through Web Push), the kinds to be notified about, and every device that
// gets the person's pushes. A push never shows a notice's text; the app opens it after the tap.
import { useCallback, useEffect, useMemo } from "react";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { PushKindView, PushSubscriptionView } from "../api-types";
import { pushStore } from "../client";
import { usePush } from "../hooks";
import { subscriptionHint, thisDeviceText, type ThisDevice } from "../push";
import { Banner, EmptyState, Jarvis3Frame, StatusPill } from "../ui";
import { formatWhen } from "./format";

export function NotificationsScreen() {
  const push = usePush();

  useEffect(() => {
    void pushStore.load();
  }, []);

  if (!push.loaded) {
    return (
      <Jarvis3Frame title="Notifications" testID="jarvis3-push">
        <EmptyState title="Loading…" />
      </Jarvis3Frame>
    );
  }
  return (
    <Jarvis3Frame title="Notifications" testID="jarvis3-push">
      {push.error ? <Banner tone="error">{push.error}</Banner> : null}
      {push.notice ? (
        <Banner tone={push.notice.tone} testID="jarvis3-push-notice">
          {push.notice.text}
        </Banner>
      ) : null}
      {push.settings && push.device ? (
        <>
          <ThisDeviceSection device={push.device} busy={push.busy} />
          <SettingsSection title="Notify me about" testID="jarvis3-push-kinds">
            <SettingsCard>
              {push.settings.kinds.map((kind) => (
                <KindRow key={kind.kind} kind={kind} busy={push.busy !== null} />
              ))}
            </SettingsCard>
          </SettingsSection>
          <SettingsSection
            title="Devices that get your notifications"
            testID="jarvis3-push-devices"
          >
            {push.settings.subscriptions.length ? (
              <SettingsCard>
                {push.settings.subscriptions.map((s) => (
                  <SubscriptionRow
                    key={s.id}
                    subscription={s}
                    thisDevice={
                      push.device?.status === "on" && push.device.subscription.id === s.id
                    }
                    busy={push.busy !== null}
                  />
                ))}
              </SettingsCard>
            ) : (
              <EmptyState
                title="No devices yet"
                hint="Turn notifications on above, on each phone or browser you use."
              />
            )}
          </SettingsSection>
        </>
      ) : null}
    </Jarvis3Frame>
  );
}

function ThisDeviceSection({ device, busy }: { device: ThisDevice; busy: string | null }) {
  const text = thisDeviceText(device);
  const on = useCallback(() => void pushStore.turnOn(), []);
  const off = useCallback(() => void pushStore.turnOff(), []);
  const test = useCallback(() => void pushStore.test(), []);
  const pill = useMemo(
    () =>
      device.status === "on" ? (
        <StatusPill tone="ok" label="On" testID="jarvis3-push-status" />
      ) : (
        <StatusPill tone="muted" label="Off" testID="jarvis3-push-status" />
      ),
    [device.status],
  );
  return (
    <SettingsSection title="This device" testID="jarvis3-push-device">
      <SettingsCard>
        <SettingsRow label={text.title} hint={text.hint} labelAccessory={pill}>
          {device.status === "off" ? (
            <Button
              variant="default"
              size="sm"
              onPress={on}
              loading={busy === "on"}
              disabled={busy !== null}
              testID="jarvis3-push-on"
            >
              Turn on
            </Button>
          ) : null}
          {device.status === "on" ? (
            <Button
              variant="outline"
              size="sm"
              onPress={off}
              loading={busy === "off"}
              disabled={busy !== null}
              testID="jarvis3-push-off"
            >
              Turn off
            </Button>
          ) : null}
        </SettingsRow>
        {device.status === "on" ? (
          <SettingsRow label="Send a test notification" hint="To every device listed below.">
            <Button
              variant="outline"
              size="sm"
              onPress={test}
              loading={busy === "test"}
              disabled={busy !== null}
              testID="jarvis3-push-test"
            >
              Send test
            </Button>
          </SettingsRow>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

function KindRow({ kind, busy }: { kind: PushKindView; busy: boolean }) {
  const toggle = useCallback(
    (value: boolean) => void pushStore.setKind(kind.kind, value),
    [kind.kind],
  );
  return (
    <SettingsRow label={kind.label} testID={`jarvis3-push-kind-${kind.kind}`}>
      <Switch
        value={kind.enabled}
        onValueChange={toggle}
        disabled={busy}
        accessibilityLabel={kind.label}
        testID={`jarvis3-push-kind-toggle-${kind.kind}`}
      />
    </SettingsRow>
  );
}

function SubscriptionRow({
  subscription,
  thisDevice,
  busy,
}: {
  subscription: PushSubscriptionView;
  thisDevice: boolean;
  busy: boolean;
}) {
  const remove = useCallback(() => void pushStore.remove(subscription.id), [subscription.id]);
  const label = thisDevice ? `${subscription.label} (this device)` : subscription.label;
  return (
    <SettingsRow
      label={label}
      hint={`${subscription.kind === "apns" ? "iOS app" : "Web"} · ${subscriptionHint(subscription, formatWhen)}`}
      testID={`jarvis3-push-sub-${subscription.id}`}
    >
      <Button
        variant="ghost"
        size="sm"
        onPress={remove}
        disabled={busy}
        testID={`jarvis3-push-remove-${subscription.id}`}
      >
        Remove
      </Button>
    </SettingsRow>
  );
}
