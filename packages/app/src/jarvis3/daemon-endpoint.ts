// How a Jarvis 3 task becomes a Paseo host.
//
// Paseo's direct host builds `ws(s)://<host>:<port>/ws` from its endpoint and has no field for a
// path. The stored registry also rewrites every direct connection's id to `direct:<endpoint>`,
// and merges hosts that share an endpoint. So each task gets its own pseudo-endpoint under the
// reserved `.invalid` TLD (`t-<taskId>.jarvis3.invalid:443`), which stays distinct and survives
// persistence, and one hook in the URL builders (host-runtime.ts, test-daemon-connection.ts)
// turns it into the instance's daemon proxy: `wss://<instance>/api/tasks/<id>/daemon`.
//
// No React Native imports here: upstream modules import this file.

const PSEUDO_SUFFIX = ".jarvis3.invalid";
const PSEUDO_PORT = 443;
const TASK_ID_RE = /^[a-z0-9][a-z0-9-]{0,61}$/;

// The web app is served by the instance, so its origin is the instance. iOS registers the
// configured URL (jarvis3/client.ts, loaded through the websocket-factory hook).
const pageOrigin = () =>
  (globalThis as { location?: { origin?: string } }).location?.origin ?? null;
let instanceUrlResolver: (() => string | null) | null = pageOrigin;

/** Set by the jarvis3 variant at startup. Only `.jarvis3.invalid` endpoints ever consult it. */
export function setJarvis3InstanceUrlResolver(resolver: (() => string | null) | null): void {
  instanceUrlResolver = resolver;
}

export function taskEndpoint(taskId: string): string {
  const id = taskId.toLowerCase();
  if (!TASK_ID_RE.test(id)) throw new Error(`Task id can't be used as a host: ${taskId}`);
  return `t-${id}${PSEUDO_SUFFIX}:${PSEUDO_PORT}`;
}

/** The task id an endpoint stands for, or null when it is an ordinary daemon endpoint. */
export function taskIdFromEndpoint(endpoint: string): string | null {
  const match = /^t-([a-z0-9][a-z0-9-]*)\.jarvis3\.invalid:\d+$/.exec(
    endpoint.trim().toLowerCase(),
  );
  return match ? match[1] : null;
}

/** `wss://<instance>/api/tasks/<id>/daemon` (ws:// for an http instance, e.g. a local server). */
export function buildTaskDaemonUrl(instanceUrl: string, taskId: string): string {
  const base = new URL(instanceUrl);
  const scheme = base.protocol === "http:" ? "ws:" : "wss:";
  return `${scheme}//${base.host}/api/tasks/${encodeURIComponent(taskId)}/daemon`;
}

/**
 * The hook upstream's URL builders call first: the proxy URL for a task's pseudo-endpoint,
 * or null to let upstream build its usual `/ws` URL.
 */
export function jarvis3DaemonUrl(endpoint: string): string | null {
  const taskId = taskIdFromEndpoint(endpoint);
  if (!taskId) return null;
  const instanceUrl = instanceUrlResolver?.();
  if (!instanceUrl)
    throw new Error("This host belongs to a Jarvis 3 instance this app isn't set up for.");
  return buildTaskDaemonUrl(instanceUrl, taskId);
}

/** Whether a WebSocket URL goes to the instance's daemon proxy (it then needs the device headers). */
export function isTaskDaemonUrl(instanceUrl: string, url: string): boolean {
  try {
    const target = new URL(url);
    const base = new URL(instanceUrl);
    return target.host === base.host && /^\/api\/tasks\/[^/]+\/daemon$/.test(target.pathname);
  } catch {
    return false;
  }
}

/**
 * The instance's HTTP relay to a task's daemon for `pathAndQuery` (which starts with "/"):
 * `https://<instance>/api/tasks/<id>/daemon/http<pathAndQuery>`. null for an ordinary endpoint.
 * Paseo fetches file downloads over the daemon's HTTP; the relay adds the daemon password.
 */
export function jarvis3DaemonHttpUrl(endpoint: string, pathAndQuery: string): string | null {
  const taskId = taskIdFromEndpoint(endpoint);
  if (!taskId) return null;
  if (!pathAndQuery.startsWith("/"))
    throw new Error(`Daemon path must start with "/": ${pathAndQuery}`);
  const instanceUrl = instanceUrlResolver?.();
  if (!instanceUrl)
    throw new Error("This host belongs to a Jarvis 3 instance this app isn't set up for.");
  const base = new URL(instanceUrl);
  return `${base.protocol}//${base.host}/api/tasks/${encodeURIComponent(taskId)}/daemon/http${pathAndQuery}`;
}
