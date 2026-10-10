// Push notifications for notices (docs/API.md section 16 in DE0CH/jarvis3): the settings store,
// what a push's data opens, and the words the settings screen shows. The device side (asking for
// permission, the APNs token or the browser's Web Push subscription) is behind PushDevice, with
// one implementation per platform (push-device.web.ts, push-device.native.ts). No React Native here.
import type { Jarvis3Api } from "./api";
import type {
  CreatePushSubscriptionRequest,
  NoticeView,
  PushKind,
  PushSettings,
  PushSubscriptionView,
} from "./api-types";
import { noticeTarget } from "./schedules";
import { messageOf, type Store } from "./stores";

/**
 * What this device can do.
 * ready: it can ask for permission and subscribe. denied: the person refused notifications in the
 * system settings. needs-home-screen: Safari on iPhone/iPad, which offers Web Push only to a web app
 * added to the Home Screen. unsupported: no push on this platform or browser.
 */
export type PushSupport = "ready" | "denied" | "needs-home-screen" | "unsupported";

export type PushDeviceResult =
  | { ok: true; request: CreatePushSubscriptionRequest }
  | { ok: false; support: PushSupport; message?: string };

export interface PushDevice {
  /** Which channel this platform uses: the iOS app APNs, a browser Web Push. */
  readonly channel: "apns" | "web";
  support(): Promise<PushSupport>;
  /** Asks for permission (call from a tap) and returns what to register with the instance. */
  subscribe(webPushPublicKey: string | null): Promise<PushDeviceResult>;
  /** The registration of a device that already allowed notifications, without asking; null otherwise. */
  current(webPushPublicKey: string | null): Promise<CreatePushSubscriptionRequest | null>;
  /** Drops the browser's own subscription (the instance's side is deleted by the API). */
  unsubscribe(): Promise<void>;
  /** The id the instance gave this device's subscription, kept on the device. */
  savedId(): Promise<string | null>;
  saveId(id: string | null): Promise<void>;
  /** The app icon's badge (the unread count). */
  setBadge(count: number): Promise<void>;
}

/** This device's state on the settings screen. */
export type ThisDevice =
  | { status: "on"; subscription: PushSubscriptionView }
  | { status: "off" }
  | { status: "unavailable" }
  | { status: PushSupport & ("denied" | "needs-home-screen" | "unsupported") };

export function thisDeviceStatus(input: {
  settings: PushSettings;
  channel: "apns" | "web";
  support: PushSupport;
  savedId: string | null;
}): ThisDevice {
  const { settings, channel, support, savedId } = input;
  const offered = channel === "apns" ? settings.apns : settings.webPushPublicKey !== null;
  if (!offered) return { status: "unavailable" };
  if (support !== "ready") return { status: support };
  const mine = savedId ? settings.subscriptions.find((s) => s.id === savedId) : undefined;
  return mine ? { status: "on", subscription: mine } : { status: "off" };
}

export function thisDeviceText(device: ThisDevice): { title: string; hint: string } {
  switch (device.status) {
    case "on":
      return {
        title: "On for this device",
        hint: device.subscription.lastError
          ? `The last push failed: ${device.subscription.lastError}`
          : "You get a notification here for the kinds switched on below.",
      };
    case "off":
      return { title: "Off for this device", hint: "Turn it on to get notified here." };
    case "denied":
      return {
        title: "Notifications are blocked",
        hint: "Allow notifications for this app in the system settings, then come back.",
      };
    case "needs-home-screen":
      return {
        title: "Add Jarvis to your Home Screen first",
        hint: "On iPhone and iPad, Safari sends notifications only to a web app on the Home Screen: tap Share, then Add to Home Screen, and open Jarvis from there.",
      };
    case "unsupported":
      return {
        title: "Not available here",
        hint: "This browser can't receive push notifications.",
      };
    case "unavailable":
      return {
        title: "Not set up for this device",
        hint: "The instance has no push keys for this kind of device yet.",
      };
  }
}

export function subscriptionHint(
  s: PushSubscriptionView,
  formatWhen: (iso: string) => string,
): string {
  if (s.lastError) return `Last push failed: ${s.lastError}`;
  if (s.lastOkAt) return `Last push ${formatWhen(s.lastOkAt)}`;
  return `Added ${formatWhen(s.createdAt)}`;
}

// ---- what a tap opens ----------------------------------------------------------------------

function pick(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.jarvis3 === "string") return d;
  // expo-notifications may hand over the APNs payload's `body` as the data, or keep it nested
  if (d.body && typeof d.body === "object") return pick(d.body);
  return null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** The route a tapped push opens, or null when the push isn't a Jarvis 3 one. */
export function pushRoute(data: unknown): string | null {
  const d = pick(data);
  if (!d) return null;
  if (d.jarvis3 === "test") return "/me/notifications";
  const target = noticeTarget({
    kind: (str(d.kind) ?? "task_failed") as NoticeView["kind"],
    taskId: str(d.taskId),
    approvalId: str(d.approvalId),
  });
  return target?.href ?? "/notices";
}

// ---- the store ------------------------------------------------------------------------------

export interface PushState {
  loaded: boolean;
  settings: PushSettings | null;
  device: ThisDevice | null;
  error: string | null;
  /** What is in flight: turning on/off, a test, removing a subscription, or a kind being switched. */
  busy: "on" | "off" | "test" | `remove:${string}` | `kind:${PushKind}` | null;
  /** The last action's outcome, shown inline. */
  notice: { tone: "ok" | "error"; text: string } | null;
}

export function createPushStore(
  api: Jarvis3Api,
  device: PushDevice,
): Store<PushState> & {
  load(): Promise<void>;
  turnOn(): Promise<void>;
  turnOff(): Promise<void>;
  setKind(kind: PushKind, enabled: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  test(): Promise<void>;
  resync(): Promise<void>;
} {
  let state: PushState = {
    loaded: false,
    settings: null,
    device: null,
    error: null,
    busy: null,
    notice: null,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<PushState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };

  async function refresh(settings?: PushSettings): Promise<void> {
    const s = settings ?? (await api.pushSettings());
    const [support, savedId] = await Promise.all([device.support(), device.savedId()]);
    set({
      loaded: true,
      settings: s,
      device: thisDeviceStatus({ settings: s, channel: device.channel, support, savedId }),
      error: null,
    });
  }

  async function run(
    busy: NonNullable<PushState["busy"]>,
    fn: () => Promise<PushState["notice"]>,
  ): Promise<void> {
    if (state.busy) return;
    set({ busy, notice: null });
    try {
      const notice = await fn();
      set({ busy: null, notice });
    } catch (error) {
      set({ busy: null, notice: { tone: "error", text: messageOf(error) } });
    }
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async load() {
      try {
        await refresh();
      } catch (error) {
        set({ loaded: true, error: messageOf(error) });
      }
    },
    turnOn: () =>
      run("on", async () => {
        const r = await device.subscribe(state.settings?.webPushPublicKey ?? null);
        if (!r.ok) {
          await refresh();
          return r.message ? { tone: "error", text: r.message } : null;
        }
        const sub = await api.subscribePush(r.request);
        await device.saveId(sub.id);
        await refresh();
        return { tone: "ok", text: "Notifications are on for this device." };
      }),
    turnOff: () =>
      run("off", async () => {
        const id = await device.savedId();
        if (id) await api.unsubscribePush(id).catch(() => undefined); // already gone is fine
        await device.unsubscribe();
        await device.saveId(null);
        await refresh();
        return { tone: "ok", text: "Notifications are off for this device." };
      }),
    setKind: (kind, enabled) =>
      run(`kind:${kind}`, async () => {
        await refresh(await api.setPushKinds({ [kind]: enabled }));
        return null;
      }),
    remove: (id) =>
      run(`remove:${id}`, async () => {
        await api.unsubscribePush(id);
        if ((await device.savedId()) === id) {
          await device.unsubscribe();
          await device.saveId(null);
        }
        await refresh();
        return null;
      }),
    test: () =>
      run("test", async () => {
        const { results } = await api.testPush();
        await refresh();
        if (!results.length)
          return { tone: "error", text: "No device gets your notifications yet." };
        const failed = results.filter((r) => !r.ok);
        if (!failed.length)
          return {
            tone: "ok",
            text:
              results.length === 1
                ? "Test notification sent."
                : `Test notification sent to ${results.length} devices.`,
          };
        return {
          tone: "error",
          text: `${failed.length} of ${results.length} failed: ${failed.map((f) => f.error).join("; ")}`,
        };
      }),
    /** At start: a device that is on registers again (an APNs token or a browser subscription can change). */
    async resync() {
      try {
        if (!(await device.savedId()) || (await device.support()) !== "ready") return;
        const s = await api.pushSettings();
        const request = await device.current(s.webPushPublicKey);
        if (!request) return;
        const sub = await api.subscribePush(request);
        await device.saveId(sub.id);
      } catch {
        // the settings screen shows the state; nothing to tell the person here
      }
    },
  };
}

export type PushStore = ReturnType<typeof createPushStore>;

/** The settings screen's order and labels come from the server; this is only the section title. */
export const PUSH_SETTINGS_TITLE = "Notifications";
