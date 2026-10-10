// The fallback device (type checks and any platform without push). The web build uses
// push-device.web.ts, iOS push-device.native.ts.
import type { PushDevice } from "./push";

export const pushDevice: PushDevice = {
  channel: "web",
  support: async () => "unsupported",
  subscribe: async () => ({ ok: false, support: "unsupported" }),
  current: async () => null,
  unsubscribe: async () => undefined,
  savedId: async () => null,
  saveId: async () => undefined,
  setBadge: async () => undefined,
};

/** Calls `open(route)` when a notification of this app is tapped while the app runs (web only). */
export function onPushOpen(_open: (route: string) => void): () => void {
  return () => undefined;
}
