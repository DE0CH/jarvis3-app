// A real Paseo daemon (dev supervisor, mock agent provider, a daemon password) standing in for
// a task's session: the mock instance relays the app's WebSocket to it, as the real server does
// over the session's reverse channel. One mock agent is seeded, as the session image starts one
// with the task's first prompt.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { killProcessTree, spawnTsx } from "../e2e/support/helpers/spawn-node";

export interface TaskDaemon {
  url: string;
  password: string;
  serverId: string;
  agentId: string;
  close(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port: number, child: ChildProcess, stderr: () => string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`daemon exited (${child.exitCode}): ${stderr()}`);
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
    });
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`daemon did not listen on ${port}: ${stderr()}`);
}

interface SeedClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  createWorkspace(input: { source: { kind: "directory"; path: string }; title?: string }): Promise<{
    workspace: { id: string } | null;
    error: string | null;
  }>;
  createAgent(options: {
    provider: string;
    cwd: string;
    workspaceId?: string;
    title?: string;
    modeId?: string;
    model?: string;
    initialPrompt?: string;
  }): Promise<{ id: string }>;
  getLastServerInfoMessage?(): { serverId?: string } | null;
}

export async function startTaskDaemon(options: {
  firstPrompt: string;
  title: string;
}): Promise<TaskDaemon> {
  const port = await freePort();
  const password = randomBytes(18).toString("hex");
  const serverId = `srv_${randomBytes(6).toString("hex")}`;
  const paseoHome = await mkdtemp(path.join(tmpdir(), "jarvis3-e2e-daemon-"));
  const workdir = await mkdtemp(path.join(tmpdir(), "jarvis3-e2e-task-"));
  const serverDir = path.resolve(__dirname, "../../server");
  let stderr = "";
  const child = spawnTsx("scripts/supervisor-entrypoint.ts", ["--dev"], {
    cwd: serverDir,
    env: {
      ...process.env,
      PASEO_HOME: paseoHome,
      PASEO_SERVER_ID: serverId,
      PASEO_LISTEN: `127.0.0.1:${port}`,
      PASEO_PASSWORD: password,
      PASEO_RELAY_ENABLED: "0",
      PASEO_DICTATION_ENABLED: "0",
      PASEO_VOICE_MODE_ENABLED: "0",
      PASEO_NODE_ENV: "development",
      NODE_ENV: "development",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).split("\n").slice(-40).join("\n");
  });

  const cleanup = async () => {
    await killProcessTree(child);
    await rm(paseoHome, { recursive: true, force: true });
    await rm(workdir, { recursive: true, force: true });
  };

  try {
    await waitForPort(port, child, () => stderr);
    const repoRoot = path.resolve(__dirname, "../../..");
    const mod = (await import(
      pathToFileURL(path.join(repoRoot, "packages/client/dist/daemon-client.js")).href
    )) as {
      DaemonClient: new (config: Record<string, unknown>) => SeedClient;
    };
    const url = `ws://127.0.0.1:${port}/ws`;
    const client = new mod.DaemonClient({
      url,
      clientId: `jarvis3-e2e-${randomUUID()}`,
      clientType: "cli",
      password,
      webSocketFactory: (
        target: string,
        opts?: { headers?: Record<string, string>; protocols?: string[] },
      ) => new WebSocket(target, opts?.protocols, { headers: opts?.headers }),
    });
    await client.connect();
    const created = await client.createWorkspace({
      source: { kind: "directory", path: workdir },
      title: options.title,
    });
    if (!created.workspace)
      throw new Error(created.error ?? "could not create the task's workspace");
    const agent = await client.createAgent({
      provider: "mock",
      cwd: workdir,
      workspaceId: created.workspace.id,
      title: options.title,
      modeId: "load-test",
      model: "e2e-fast-stream",
      initialPrompt: options.firstPrompt,
    });
    await client.close();
    return { url, password, serverId, agentId: agent.id, close: cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
