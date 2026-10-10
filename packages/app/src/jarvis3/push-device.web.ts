// Web Push in the browser and in a web app added to the iPhone/iPad Home Screen: the service
// worker public/jarvis3-push-sw.js shows each push and opens its screen on a tap. Safari on
// iPhone/iPad has no PushManager outside a Home Screen web app, so the screen says to add it first.
import type { CreatePushSubscriptionRequest } from "./api-types";
import type { PushDevice, PushSupport } from "./push";

const SW_URL = "/jarvis3-push-sw.js";
const ID_KEY = "jarvis3-push-subscription";

interface Win {
  navigator: Navigator & {
    standalone?: boolean;
    setAppBadge?: (n: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  PushManager?: unknown;
  Notification?: {
    permission: NotificationPermission;
    requestPermission(): Promise<NotificationPermission>;
  };
  localStorage?: Storage;
  matchMedia?: (q: string) => { matches: boolean };
}
const win = globalThis as unknown as Win;

function isAppleMobile(): boolean {
  const ua = win.navigator?.userAgent ?? "";
  // iPadOS reports a Mac user agent; touch points tell them apart
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && (win.navigator?.maxTouchPoints ?? 0) > 1)
  );
}

function isStandalone(): boolean {
  return (
    win.navigator?.standalone === true ||
    win.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

async function support(): Promise<PushSupport> {
  const has = "serviceWorker" in (win.navigator ?? {}) && !!win.PushManager && !!win.Notification;
  if (!has) return isAppleMobile() && !isStandalone() ? "needs-home-screen" : "unsupported";
  if (win.Notification!.permission === "denied") return "denied";
  return "ready";
}

function keyBytes(base64url: string): Uint8Array {
  const b64 = base64url
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameKey(sub: PushSubscription, publicKey: string): boolean {
  const k = sub.options?.applicationServerKey;
  if (!k) return true; // a browser that doesn't report it: keep the subscription
  const a = new Uint8Array(k);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];
const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Mac OS X/, "macOS"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
];
const first = (ua: string, list: [RegExp, string][]): string | null =>
  list.find(([re]) => re.test(ua))?.[1] ?? null;

/** "Chrome on macOS", "iPhone Home Screen app": how the device list names this browser. */
function browserLabel(): string {
  const ua = win.navigator?.userAgent ?? "";
  const browser = first(ua, BROWSERS) ?? "Browser";
  const os = first(ua, SYSTEMS);
  if (isStandalone()) return `${os ?? "device"} Home Screen app`;
  return os ? `${browser} on ${os}` : browser;
}

function requestOf(sub: PushSubscription): CreatePushSubscriptionRequest {
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  return {
    kind: "web",
    endpoint: json.endpoint ?? sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    label: browserLabel(),
  };
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await win.navigator.serviceWorker.register(SW_URL, { scope: "/" });
  return win.navigator.serviceWorker.ready;
}

export const pushDevice: PushDevice = {
  channel: "web",
  support,
  async subscribe(publicKey) {
    const s = await support();
    if (s !== "ready") return { ok: false, support: s };
    if (!publicKey) return { ok: false, support: "unsupported" };
    const permission = await win.Notification!.requestPermission();
    if (permission !== "granted")
      return {
        ok: false,
        support: permission === "denied" ? "denied" : "ready",
        ...(permission === "denied" ? {} : { message: "Notifications weren't allowed." }),
      };
    try {
      const reg = await registration();
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub, publicKey)) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey) as BufferSource,
      });
      return { ok: true, request: requestOf(sub) };
    } catch (error) {
      return {
        ok: false,
        support: "ready",
        message: `This browser couldn't subscribe: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  async current(publicKey) {
    if ((await support()) !== "ready" || win.Notification!.permission !== "granted" || !publicKey)
      return null;
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    return sub && sameKey(sub, publicKey) ? requestOf(sub) : null;
  },
  async unsubscribe() {
    if (!("serviceWorker" in (win.navigator ?? {}))) return;
    const reg = await win.navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager?.getSubscription();
    await sub?.unsubscribe();
  },
  async savedId() {
    try {
      return win.localStorage?.getItem(ID_KEY) ?? null;
    } catch {
      return null;
    }
  },
  async saveId(id) {
    try {
      if (id) win.localStorage?.setItem(ID_KEY, id);
      else win.localStorage?.removeItem(ID_KEY);
    } catch {
      // private mode: the screen shows "off" next time, and turning it on again moves the same subscription
    }
  },
  async setBadge(count) {
    try {
      if (count > 0) await win.navigator.setAppBadge?.(count);
      else await win.navigator.clearAppBadge?.();
    } catch {
      // badges are optional
    }
  },
};

/** A tapped notification while a window is open: the service worker posts the route to open. */
export function onPushOpen(open: (route: string) => void): () => void {
  const sw = win.navigator?.serviceWorker;
  if (!sw) return () => undefined;
  const listener = (event: MessageEvent) => {
    const route = (event.data as { jarvis3Open?: unknown } | null)?.jarvis3Open;
    if (typeof route === "string" && route.startsWith("/")) open(route);
  };
  sw.addEventListener("message", listener);
  return () => sw.removeEventListener("message", listener);
}
