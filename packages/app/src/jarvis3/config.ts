// Which build this is. The jarvis3 variant (APP_VARIANT=jarvis3 in app.config.js) sets
// `extra.jarvis = { version: 3, url, scheme }`; every other variant leaves version unset.
import Constants from "expo-constants";
import { Platform } from "react-native";
import { resolveInstanceUrl } from "./plan";

interface Jarvis3Extra {
  version?: number;
  url?: string;
  scheme?: string;
}

const extra = (Constants.expoConfig?.extra as { jarvis?: Jarvis3Extra } | undefined)?.jarvis;

export const isJarvis3 = extra?.version === 3;

/** The app's own URL scheme, for the pairing redirect (`<scheme>://paired`). */
export const jarvis3Scheme = extra?.scheme ?? "jarvis3";

export function getInstanceUrl(): string | null {
  if (!isJarvis3) return null;
  const origin =
    Platform.OS === "web"
      ? ((globalThis as { location?: { origin?: string } }).location?.origin ?? null)
      : null;
  return resolveInstanceUrl({ platform: Platform.OS, extraUrl: extra?.url, origin });
}
