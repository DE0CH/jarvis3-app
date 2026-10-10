// Hook for stores/download-store.ts: a file download from a task's daemon goes through the
// instance's HTTP relay (docs/API.md in DE0CH/jarvis3, "HTTP to the daemon"). On the web the page
// is on the instance's origin, so the browser's Access cookie goes along with the link; on iOS
// the paired device's Access headers are sent.
//
// No React Native imports here: an upstream module imports this file.
import { jarvis3DaemonHttpUrl } from "./daemon-endpoint";
import { deviceHeaders } from "./device-token";

interface DaemonConnection {
  type: string;
  endpoint?: string;
}

/** The download request for a task host, or null to let upstream build its usual one. */
export function jarvis3DownloadRequest(
  daemon: { connections: readonly DaemonConnection[] } | undefined,
  token: string,
): { url: string; headers: Record<string, string> | null } | null {
  const endpoint = daemon?.connections.find((c) => c.type === "directTcp")?.endpoint;
  if (!endpoint) return null;
  const url = jarvis3DaemonHttpUrl(
    endpoint,
    `/api/files/download?${new URLSearchParams({ token }).toString()}`,
  );
  return url ? { url, headers: deviceHeaders() } : null;
}
