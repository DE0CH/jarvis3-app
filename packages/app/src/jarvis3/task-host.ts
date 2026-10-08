// A task's Paseo host: a direct connection to the task's pseudo-endpoint (daemon-endpoint.ts),
// which the URL hook sends to the instance's daemon proxy. The serverId is the daemon's own,
// learned by probing through the proxy the first time the task is opened.
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { taskEndpoint, taskIdFromEndpoint } from "./daemon-endpoint";

export function findTaskHost(hosts: readonly HostProfile[], taskId: string): HostProfile | null {
  const endpoint = taskEndpoint(taskId);
  return (
    hosts.find((host) =>
      host.connections.some(
        (connection) => connection.type === "directTcp" && connection.endpoint === endpoint,
      ),
    ) ?? null
  );
}

const inflight = new Map<string, Promise<string>>();

/** Makes (once) the host for a task and returns its serverId. */
export function ensureTaskHost(taskId: string, label: string): Promise<string> {
  const existing = inflight.get(taskId);
  if (existing) return existing;
  const run = (async () => {
    const store = getHostRuntimeStore();
    const found = findTaskHost(store.getHosts(), taskId);
    if (found) return found.serverId;
    const endpoint = taskEndpoint(taskId);
    const { serverId } = await store.probeAndUpsertConnection({
      connection: { id: `direct:${endpoint}`, type: "directTcp", endpoint, useTls: true },
      label,
      timeoutMs: 15_000,
    });
    return serverId;
  })();
  inflight.set(taskId, run);
  run.finally(() => inflight.delete(taskId)).catch(() => undefined);
  return run;
}

/** Drops the hosts of tasks that no longer exist or are archived (called with the task list). */
export async function pruneTaskHosts(liveTaskIds: ReadonlySet<string>): Promise<void> {
  const store = getHostRuntimeStore();
  for (const host of store.getHosts()) {
    const endpoint = host.connections.find((c) => c.type === "directTcp")?.endpoint ?? "";
    const taskId = taskIdFromEndpoint(endpoint);
    if (taskId && !liveTaskIds.has(taskId))
      await store.removeHost(host.serverId).catch(() => undefined);
  }
}
