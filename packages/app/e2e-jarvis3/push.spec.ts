// Push notification settings in the jarvis3 web build against the mock instance: the Notices
// screen's entry, this browser turned on and off (Web Push through the real service worker; the
// browser's PushManager is stubbed, since a test browser has no push service), a test push, the
// per-kind switches (two-phase, kept after a reload), the device list with Remove, another user's
// isolation, and Safari on iPhone outside the Home Screen. Saves phone (390) and desktop (1400)
// screenshots, light and dark, to JARVIS3_SCREENSHOT_DIR (default e2e-artifacts/jarvis3).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { NoticeView } from "../src/jarvis3/api-types";
import { startMockInstance, type MockInstance } from "./mock-instance";

const DIST = path.resolve(__dirname, "../dist-jarvis3");
const SHOTS = path.resolve(
  process.env.JARVIS3_SCREENSHOT_DIR ?? path.resolve(__dirname, "../e2e-artifacts/jarvis3"),
);
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/e2e-browser-subscription";

let instance: MockInstance;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const notices: Record<string, NoticeView[]> = {
    "u-alice": [
      {
        id: "n-1",
        kind: "approval_decided",
        text: "Your request to email the supplier was approved.",
        taskId: null,
        approvalId: null,
        createdAt: "2026-10-10T09:00:00.000Z",
        read: false,
      },
    ],
  };
  instance = await startMockInstance({ distDir: DIST, notices });
});

test.afterAll(async () => {
  await instance?.close();
});

async function signIn(context: BrowserContext, email: string): Promise<void> {
  await context.addCookies([{ name: "CF_Authorization", value: email, url: instance.url }]);
}

/**
 * A browser without a push service: PushManager.subscribe answers a fixed subscription, and
 * notifications are allowed (Notification.permission and its prompt answer "granted").
 */
async function stubPushService(context: BrowserContext): Promise<void> {
  await context.grantPermissions(["notifications"], { origin: instance.url });
  await context.addInitScript((endpoint: string) => {
    let current: unknown = null;
    const fake = {
      endpoint,
      options: { applicationServerKey: null },
      toJSON: () => ({
        endpoint,
        keys: {
          p256dh:
            "BAcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
          auth: "AQEBAQEBAQEBAQEBAQEBAQ",
        },
      }),
      unsubscribe: async () => {
        current = null;
        return true;
      },
    };
    // headless Chromium reports notifications as denied whatever was granted
    const N = (globalThis as unknown as { Notification?: { requestPermission: unknown } })
      .Notification;
    if (N) {
      Object.defineProperty(N, "permission", { get: () => "granted", configurable: true });
      N.requestPermission = async () => "granted";
    }
    const proto = (
      globalThis as unknown as { PushManager?: { prototype: Record<string, unknown> } }
    ).PushManager?.prototype;
    if (proto) {
      proto.subscribe = async () => (current = fake);
      proto.getSubscription = async () => current;
    }
  }, ENDPOINT);
}

async function shoot(page: Page, name: string, ready: () => Promise<void>): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [label, width, height] of [
      ["phone", 390, 1200],
      ["desktop", 1400, 1000],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(400);
      await ready();
      await page.screenshot({
        path: path.join(SHOTS, `push-${name}-${label}-${scheme}.png`),
        fullPage: true,
      });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 900 });
  // Crossing Paseo's compact/desktop breakpoint remounts the route; carry on from a settled page.
  await page.reload();
  await ready();
}

test("turning this browser on and off, a test push, the device list", async ({ page, context }) => {
  await stubPushService(context);
  await signIn(context, "alice@example.org");
  await page.goto(`${instance.url}/notices`);
  await page.getByTestId("jarvis3-push-settings").click();
  await expect(page).toHaveURL(/\/me\/notifications$/);
  const device = page.getByTestId("jarvis3-push-device");
  await expect(device).toContainText("Off for this device");
  await expect(page.getByTestId("jarvis3-push-devices")).toContainText("No devices yet");
  await shoot(page, "off", () => expect(device).toContainText("Off for this device"));

  await page.getByTestId("jarvis3-push-on").click();
  await expect(device).toContainText("On for this device");
  await expect(page.getByTestId("jarvis3-push-notice")).toContainText(
    "Notifications are on for this device.",
  );
  // the real service worker was registered at the instance's root
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return reg?.active?.scriptURL ?? reg?.installing?.scriptURL ?? reg?.waiting?.scriptURL ?? null;
  });
  expect(sw).toMatch(/\/jarvis3-push-sw\.js$/);
  const [stored] = instance.state.pushSubscriptions;
  expect(stored).toMatchObject({ userId: "u-alice", kind: "web", address: ENDPOINT });
  expect(stored?.label).toMatch(/Chrome/);
  await expect(page.getByTestId("jarvis3-push-devices")).toContainText("(this device)");

  await page.getByTestId("jarvis3-push-test").click();
  await expect(page.getByTestId("jarvis3-push-notice")).toContainText("Test notification sent.");
  expect(instance.state.pushSent).toEqual([
    { userId: "u-alice", subscriptionId: stored!.id, title: "Test notification" },
  ]);
  await shoot(page, "on", () => expect(device).toContainText("On for this device"));

  // a reload keeps it on (the id is kept in the browser, the subscription on the instance)
  await page.reload();
  await expect(device).toContainText("On for this device");

  await page.getByTestId("jarvis3-push-off").click();
  await expect(device).toContainText("Off for this device");
  expect(instance.state.pushSubscriptions).toEqual([]);
});

test("kinds switch on the server's answer and stay switched", async ({ page, context }) => {
  await signIn(context, "alice@example.org");
  await page.goto(`${instance.url}/me/notifications`);
  const kinds = page.getByTestId("jarvis3-push-kinds");
  await expect(kinds).toContainText("Questions for you (ask the boss)");
  await expect(kinds).toContainText("New posts in your tasks' channels");
  const toggle = page.getByTestId("jarvis3-push-kind-toggle-channel_post");
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect(instance.state.pushPrefs.get("u-alice")?.get("channel_post")).toBe(false);
  await page.reload();
  await expect(page.getByTestId("jarvis3-push-kind-toggle-channel_post")).not.toBeChecked();
  await expect(page.getByTestId("jarvis3-push-kind-toggle-question")).toBeChecked();
  await page.getByTestId("jarvis3-push-kind-toggle-channel_post").click();
  await expect(page.getByTestId("jarvis3-push-kind-toggle-channel_post")).toBeChecked();
});

test("another user's devices are neither listed nor removable", async ({ page, context }) => {
  await stubPushService(context);
  await signIn(context, "alice@example.org");
  await page.goto(`${instance.url}/me/notifications`);
  await page.getByTestId("jarvis3-push-on").click();
  await expect(page.getByTestId("jarvis3-push-device")).toContainText("On for this device");
  const aliceSub = instance.state.pushSubscriptions[0]!.id;

  await context.clearCookies();
  await signIn(context, "bob@example.org");
  await page.goto(`${instance.url}/me/notifications`);
  await expect(page.getByTestId("jarvis3-push-devices")).toContainText("No devices yet");
  const removed = await page.request.delete(`${instance.url}/api/push/subscriptions/${aliceSub}`);
  expect(removed.status()).toBe(404);
  expect(instance.state.pushSubscriptions.map((s) => s.id)).toEqual([aliceSub]);
});

test("Safari on iPhone outside the Home Screen is told to add the web app first", async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 900 },
  });
  await context.addInitScript(() => {
    // Safari exposes no PushManager to a page that isn't a Home Screen web app
    delete (globalThis as { PushManager?: unknown }).PushManager;
  });
  await signIn(context, "alice@example.org");
  const page = await context.newPage();
  await page.goto(`${instance.url}/me/notifications`);
  const device = page.getByTestId("jarvis3-push-device");
  await expect(device).toContainText("Add Jarvis to your Home Screen first");
  await expect(page.getByTestId("jarvis3-push-on")).toHaveCount(0);
  await page.screenshot({
    path: path.join(SHOTS, "push-iphone-safari-phone-light.png"),
    fullPage: true,
  });
  await context.close();
});
