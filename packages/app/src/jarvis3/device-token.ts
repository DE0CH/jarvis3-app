// The paired device's Access service token, in memory (device.ts loads and saves it in the
// Keychain). Kept free of native modules so the WebSocket hook can read it.
export interface DeviceToken {
  id: string;
  clientId: string;
  clientSecret: string;
  pairedAt: number;
}

let current: DeviceToken | null = null;

export function getDeviceToken(): DeviceToken | null {
  return current;
}

export function setDeviceToken(token: DeviceToken | null): void {
  current = token;
}

/** CF-Access headers for API calls and the daemon WebSocket on iOS; null when not paired (and on the web). */
export function deviceHeaders(): Record<string, string> | null {
  if (!current) return null;
  return {
    "CF-Access-Client-Id": current.clientId,
    "CF-Access-Client-Secret": current.clientSecret,
  };
}
