// The iOS app: APNs through expo-notifications. The device token goes to the instance, which
// sends to Apple itself (no Expo push service). Android has no push in this variant.
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { CreatePushSubscriptionRequest } from "./api-types";
import type { PushDevice, PushSupport } from "./push";

const ID_KEY = "@jarvis3:push-subscription";

async function support(): Promise<PushSupport> {
  if (Platform.OS !== "ios") return "unsupported";
  const p = await Notifications.getPermissionsAsync();
  if (p.status === Notifications.PermissionStatus.DENIED && !p.canAskAgain) return "denied";
  return "ready";
}

/** iOS asks Apple for the token; with no answer (a simulator on a CI virtual machine) it never settles. */
const TOKEN_TIMEOUT_MS = 30_000;

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(what)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function tokenRequest(): Promise<CreatePushSubscriptionRequest> {
  const token = await withTimeout(
    Notifications.getDevicePushTokenAsync(),
    TOKEN_TIMEOUT_MS,
    "no answer from Apple's push service",
  );
  const label = `${Constants.deviceName ?? "iPhone"}`.slice(0, 80);
  return { kind: "apns", token: String(token.data), label };
}

export const pushDevice: PushDevice = {
  channel: "apns",
  support,
  async subscribe() {
    const s = await support();
    if (s !== "ready") return { ok: false, support: s };
    const p = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    if (p.status !== Notifications.PermissionStatus.GRANTED) {
      return {
        ok: false,
        support: p.canAskAgain ? "ready" : "denied",
        ...(p.canAskAgain ? { message: "Notifications weren't allowed." } : {}),
      };
    }
    try {
      return { ok: true, request: await tokenRequest() };
    } catch (error) {
      return {
        ok: false,
        support: "ready",
        message: `This device couldn't register for notifications: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  async current() {
    if (Platform.OS !== "ios") return null;
    const p = await Notifications.getPermissionsAsync();
    if (p.status !== Notifications.PermissionStatus.GRANTED) return null;
    return tokenRequest();
  },
  async unsubscribe() {
    // The instance deletes the token; the app stays registered with Apple for the next "Turn on".
  },
  savedId: () => AsyncStorage.getItem(ID_KEY),
  async saveId(id) {
    if (id) await AsyncStorage.setItem(ID_KEY, id);
    else await AsyncStorage.removeItem(ID_KEY);
  },
  async setBadge(count) {
    await Notifications.setBadgeCountAsync(count).catch(() => false);
  },
};

/** Taps on iOS go through expo-notifications and upstream's PushNotificationRouter (pushRoute). */
export function onPushOpen(_open: (route: string) => void): () => void {
  return () => undefined;
}
