// Hook for runtime/websocket-factory.ts (native builds): sockets to the instance's daemon proxy
// carry the paired device's Access headers. The browser can't set headers; there the Access
// cookie (same origin) authenticates. Loading this module also tells the daemon URL hook where
// the instance is (iOS has no page origin).
import type { WebSocketFactory } from "@getpaseo/client/internal/daemon-client-transport-types";
import { getInstanceUrl, isJarvis3 } from "./config";
import { isTaskDaemonUrl, setJarvis3InstanceUrlResolver } from "./daemon-endpoint";
import { deviceHeaders } from "./device-token";

/** Tells the daemon URL hook where the instance is. Idempotent; runs when this module loads. */
export function registerJarvis3InstanceUrl(): void {
  if (isJarvis3) setJarvis3InstanceUrlResolver(getInstanceUrl);
}
registerJarvis3InstanceUrl();

export function withJarvis3Headers(factory: WebSocketFactory): WebSocketFactory {
  if (!isJarvis3) return factory;
  return (url, options) => {
    const instanceUrl = getInstanceUrl();
    const headers = instanceUrl && isTaskDaemonUrl(instanceUrl, url) ? deviceHeaders() : null;
    if (!headers) return factory(url, options);
    return factory(url, { ...options, headers: { ...options?.headers, ...headers } });
  };
}
