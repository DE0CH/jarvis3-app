// iOS only: this install's own Cloudflare Access service token, minted by the instance when the
// user signs in once in the system sheet (`GET /api/devices/pair`, docs/API.md section 3).
// On the web there is no device token: the page is on the instance's origin and the browser's
// Access cookie authenticates every request and the daemon WebSocket.
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { Platform, Settings } from "react-native";
import { getInstanceUrl, jarvis3Scheme } from "./config";
import { pairErrorMessage, parsePairRedirect } from "./plan";

import { type DeviceToken, getDeviceToken, setDeviceToken } from "./device-token";

const TOKEN_KEY = "jarvis3-device-token";
let loaded = Platform.OS === "web";
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeDevice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDeviceSnapshot(): { loaded: boolean; paired: boolean } {
  return deviceSnapshot;
}
let deviceSnapshot = { loaded, paired: false };
function refreshSnapshot(): void {
  deviceSnapshot = { loaded, paired: Platform.OS === "web" || getDeviceToken() !== null };
  emit();
}
refreshSnapshot();

// A CI simulator run passes a token as launch arguments (`-jarvis3E2EClientId …
// -jarvis3E2EClientSecret …`, which iOS puts in NSUserDefaults); used for that launch only.
function launchArgumentToken(): DeviceToken | null {
  if (Platform.OS !== "ios") return null;
  const clientId = Settings.get("jarvis3E2EClientId");
  const clientSecret = Settings.get("jarvis3E2EClientSecret");
  if (
    typeof clientId !== "string" ||
    typeof clientSecret !== "string" ||
    !clientId ||
    !clientSecret
  )
    return null;
  return { id: "e2e", clientId, clientSecret, pairedAt: 0 };
}

export async function loadDevice(): Promise<void> {
  if (Platform.OS === "web" || loaded) return;
  let token = launchArgumentToken();
  if (!token) {
    const raw = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
    try {
      token = raw ? (JSON.parse(raw) as DeviceToken) : null;
    } catch {
      token = null;
    }
  }
  setDeviceToken(token);
  loaded = true;
  refreshSnapshot();
}

/** Opens the instance's sign-in in the system sheet; resolves with an error message, or null when paired. */
export async function pairDevice(): Promise<string | null> {
  const instanceUrl = getInstanceUrl();
  if (!instanceUrl) return "This app has no instance URL.";
  const nonce = Array.from(Crypto.getRandomBytes(24), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  const name = (Constants.deviceName ?? "iPhone").slice(0, 80);
  const model =
    `${Platform.OS === "ios" && Platform.isPad ? "iPad" : "iPhone"} · iOS ${String(Platform.Version)}`.slice(
      0,
      40,
    );
  const query = new URLSearchParams({ state: nonce, name, model });
  const result = await WebBrowser.openAuthSessionAsync(
    `${instanceUrl}/api/devices/pair?${query.toString()}`,
    `${jarvis3Scheme}://paired`,
    { preferEphemeralSession: false },
  );
  if (result.type !== "success") return null;
  const answer = parsePairRedirect(result.url, nonce);
  if (answer.status === "error") return pairErrorMessage(answer);
  const token = {
    id: answer.id,
    clientId: answer.clientId,
    clientSecret: answer.clientSecret,
    pairedAt: Date.now(),
  };
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(token));
  setDeviceToken(token);
  refreshSnapshot();
  return null;
}

/** A token minted seconds ago is refused until Cloudflare propagates it. */
export function isFreshlyPaired(): boolean {
  const token = getDeviceToken();
  return token !== null && Date.now() - token.pairedAt < 30_000;
}

/** Forgets this install's token (signed out, or the device was revoked). */
export async function forgetDevice(): Promise<void> {
  if (Platform.OS === "web") return;
  setDeviceToken(null);
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
  refreshSnapshot();
}
