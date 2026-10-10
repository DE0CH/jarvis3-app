import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { Jarvis3Api } from "./api";
import type {
  CreatePushSubscriptionRequest,
  NoticeView,
  PushSettings,
  PushSubscriptionView,
} from "./api-types";
import {
  createPushStore,
  pushRoute,
  thisDeviceStatus,
  thisDeviceText,
  type PushDevice,
  type PushSupport,
} from "./push";
import { noticeTarget } from "./schedules";

function sub(patch: Partial<PushSubscriptionView> = {}): PushSubscriptionView {
  return {
    id: "s1",
    kind: "web",
    label: "Chrome on macOS",
    deviceId: null,
    createdAt: "2026-10-10T12:00:00.000Z",
    lastSentAt: null,
    lastOkAt: null,
    lastError: null,
    ...patch,
  };
}

function settings(patch: Partial<PushSettings> = {}): PushSettings {
  return {
    apns: true,
    webPushPublicKey: "B".padEnd(87, "A"),
    kinds: [
      { kind: "approval_needed", label: "Approvals waiting for you", enabled: true },
      { kind: "channel_post", label: "New posts", enabled: true },
    ],
    subscriptions: [],
    ...patch,
  };
}

const WEB_REQUEST: CreatePushSubscriptionRequest = {
  kind: "web",
  endpoint: "https://fcm.googleapis.com/fcm/send/x",
  keys: { p256dh: "p", auth: "a" },
  label: "Chrome",
};

function fakeDevice(
  o: { support?: PushSupport; subscribe?: PushDevice["subscribe"]; savedId?: string | null } = {},
) {
  let saved = o.savedId ?? null;
  const calls: string[] = [];
  const device: PushDevice = {
    channel: "web",
    support: async () => o.support ?? "ready",
    subscribe: o.subscribe ?? (async () => ({ ok: true, request: WEB_REQUEST })),
    current: async () => WEB_REQUEST,
    unsubscribe: async () => {
      calls.push("unsubscribe");
    },
    savedId: async () => saved,
    saveId: async (id) => {
      saved = id;
    },
    setBadge: async () => undefined,
  };
  return { device, calls, saved: () => saved };
}

function fakeApi(initial: PushSettings) {
  let current = initial;
  const calls: { op: string; arg?: unknown }[] = [];
  const api = {
    pushSettings: async () => current,
    setPushKinds: async (kinds: Record<string, boolean>) => {
      calls.push({ op: "kinds", arg: kinds });
      current = {
        ...current,
        kinds: current.kinds.map((k) => (k.kind in kinds ? { ...k, enabled: kinds[k.kind]! } : k)),
      };
      return current;
    },
    subscribePush: async (request: CreatePushSubscriptionRequest) => {
      calls.push({ op: "subscribe", arg: request });
      const s = sub({ id: "s9" });
      current = {
        ...current,
        subscriptions: [s, ...current.subscriptions.filter((x) => x.id !== "s9")],
      };
      return s;
    },
    unsubscribePush: async (id: string) => {
      calls.push({ op: "unsubscribe", arg: id });
      current = { ...current, subscriptions: current.subscriptions.filter((x) => x.id !== id) };
      return { ok: true as const };
    },
    testPush: async () => ({
      results: current.subscriptions.map((s) => ({ id: s.id, ok: true, error: null })),
    }),
  };
  return { api: api as unknown as Jarvis3Api, calls, set: (s: PushSettings) => (current = s) };
}

describe("this device's state", () => {
  it("is on only when the saved subscription still exists", () => {
    const s = settings({ subscriptions: [sub()] });
    expect(
      thisDeviceStatus({ settings: s, channel: "web", support: "ready", savedId: "s1" }).status,
    ).toBe("on");
    expect(
      thisDeviceStatus({ settings: s, channel: "web", support: "ready", savedId: "gone" }).status,
    ).toBe("off");
    expect(
      thisDeviceStatus({ settings: s, channel: "web", support: "needs-home-screen", savedId: null })
        .status,
    ).toBe("needs-home-screen");
    expect(
      thisDeviceStatus({
        settings: settings({ webPushPublicKey: null }),
        channel: "web",
        support: "ready",
        savedId: null,
      }).status,
    ).toBe("unavailable");
    expect(
      thisDeviceStatus({
        settings: settings({ apns: false }),
        channel: "apns",
        support: "ready",
        savedId: null,
      }).status,
    ).toBe("unavailable");
  });

  it("explains the Home Screen step on iPhone Safari", () => {
    expect(thisDeviceText({ status: "needs-home-screen" }).hint).toMatch(/Add to Home Screen/);
    expect(
      thisDeviceText({ status: "on", subscription: sub({ lastError: "410: gone" }) }).hint,
    ).toMatch(/410: gone/);
  });
});

describe("what a tapped push opens", () => {
  it("opens the notice's own screen from the ids", () => {
    expect(pushRoute({ jarvis3: "notice", kind: "approval_needed", approvalId: "ap1" })).toBe(
      "/approvals/ap1",
    );
    expect(pushRoute({ jarvis3: "notice", kind: "channel_post", taskId: "t1" })).toBe(
      "/channels/t1",
    );
    expect(pushRoute({ jarvis3: "notice", kind: "task_failed", taskId: "t1" })).toBe("/tasks/t1");
    expect(pushRoute({ jarvis3: "notice", kind: "machine_hours_cap" })).toBe("/notices");
    expect(pushRoute({ jarvis3: "test" })).toBe("/me/notifications");
  });

  it("finds the data where expo-notifications puts the APNs payload's body", () => {
    expect(pushRoute({ body: { jarvis3: "notice", kind: "channel_post", taskId: "t2" } })).toBe(
      "/channels/t2",
    );
  });

  it("ignores pushes that aren't Jarvis 3's", () => {
    expect(pushRoute({ serverId: "x", agentId: "y" })).toBeNull();
    expect(pushRoute(undefined)).toBeNull();
  });

  it("the service worker opens the same screens as the app", () => {
    const code = readFileSync(join(__dirname, "../../public/jarvis3-push-sw.js"), "utf8");
    const sandbox: Record<string, unknown> = { self: { addEventListener: () => undefined } };
    runInNewContext(`${code}\nthis.targetFor = targetFor;`, sandbox);
    const targetFor = sandbox.targetFor as (data: unknown) => string;
    const kinds: NoticeView["kind"][] = [
      "approval_needed",
      "approval_decided",
      "channel_post",
      "schedule_skipped",
      "wakeup",
      "task_failed",
      "machine_hours_cap",
      "offboarded",
    ];
    for (const kind of kinds) {
      for (const ids of [
        { taskId: "t 1", approvalId: "a/1" },
        { taskId: null, approvalId: null },
      ]) {
        const app = noticeTarget({ kind, ...ids })?.href ?? "/notices";
        expect(
          targetFor({ jarvis3: "notice", kind, ...ids }),
          `${kind} ${JSON.stringify(ids)}`,
        ).toBe(app);
      }
    }
  });
});

describe("the push settings store", () => {
  it("turns this device on and off", async () => {
    const { api, calls } = fakeApi(settings());
    const d = fakeDevice();
    const store = createPushStore(api, d.device);
    await store.load();
    expect(store.get().device?.status).toBe("off");
    await store.turnOn();
    expect(calls[0]).toEqual({ op: "subscribe", arg: WEB_REQUEST });
    expect(d.saved()).toBe("s9");
    expect(store.get().device?.status).toBe("on");
    expect(store.get().notice?.tone).toBe("ok");
    await store.turnOff();
    expect(calls.at(-1)).toEqual({ op: "unsubscribe", arg: "s9" });
    expect(d.calls).toContain("unsubscribe");
    expect(d.saved()).toBeNull();
    expect(store.get().device?.status).toBe("off");
  });

  it("a refused permission registers nothing", async () => {
    const { api, calls } = fakeApi(settings());
    const d = fakeDevice({ subscribe: async () => ({ ok: false, support: "denied" }) });
    const store = createPushStore(api, d.device);
    await store.load();
    await store.turnOn();
    expect(calls).toEqual([]);
    expect(d.saved()).toBeNull();
  });

  it("switching a kind waits for the server (no optimistic flip)", async () => {
    const { api, calls } = fakeApi(settings());
    const store = createPushStore(api, fakeDevice().device);
    await store.load();
    const pending = store.setKind("channel_post", false);
    expect(store.get().busy).toBe("kind:channel_post");
    expect(store.get().settings?.kinds.find((k) => k.kind === "channel_post")?.enabled).toBe(true);
    await pending;
    expect(calls).toEqual([{ op: "kinds", arg: { channel_post: false } }]);
    expect(store.get().settings?.kinds.find((k) => k.kind === "channel_post")?.enabled).toBe(false);
    expect(store.get().busy).toBeNull();
  });

  it("removing this device's subscription also drops the browser's", async () => {
    const { api } = fakeApi(
      settings({ subscriptions: [sub({ id: "s1" }), sub({ id: "s2", kind: "apns" })] }),
    );
    const d = fakeDevice({ savedId: "s1" });
    const store = createPushStore(api, d.device);
    await store.load();
    await store.remove("s2");
    expect(d.calls).toEqual([]);
    await store.remove("s1");
    expect(d.calls).toEqual(["unsubscribe"]);
    expect(d.saved()).toBeNull();
  });

  it("a test reports failures by device", async () => {
    const { api } = fakeApi(settings({ subscriptions: [sub()] }));
    (api as unknown as { testPush: () => Promise<unknown> }).testPush = async () => ({
      results: [{ id: "s1", ok: false, error: "410: gone" }],
    });
    const store = createPushStore(api, fakeDevice({ savedId: "s1" }).device);
    await store.load();
    await store.test();
    expect(store.get().notice).toEqual({ tone: "error", text: "1 of 1 failed: 410: gone" });
  });

  it("re-registers at start only when this device is on", async () => {
    const off = fakeApi(settings());
    await createPushStore(off.api, fakeDevice().device).resync();
    expect(off.calls).toEqual([]);
    const on = fakeApi(settings({ subscriptions: [sub()] }));
    await createPushStore(on.api, fakeDevice({ savedId: "s1" }).device).resync();
    expect(on.calls.map((c) => c.op)).toEqual(["subscribe"]);
  });
});
