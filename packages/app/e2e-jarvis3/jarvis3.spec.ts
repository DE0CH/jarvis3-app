// The jarvis3 variant in a browser against a mock Jarvis 3 instance (mock-instance.ts) whose
// daemon proxy reaches a real Paseo daemon (daemon.ts). Screens: task list, New task, chat (the
// task's reported agent), Start for a paused task, My instructions & skills with Reset + Undo,
// notices with the unread count, "Suggest for everyone", admin users (cap state, an offboarded
// person's tasks, archive and layer, everyone's suggestions), and another user's task (not
// found, and its daemon socket and HTTP relay refused). The HTTP relay reaches the daemon. Saves phone (390) and desktop (1440)
// screenshots in light and dark to JARVIS3_SCREENSHOT_DIR (default e2e-artifacts/jarvis3).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { NoticeView, TaskView } from "../src/jarvis3/api-types";
import { startTaskDaemon, type TaskDaemon } from "./daemon";
import { DEFAULT_USERS, startMockInstance, type MockInstance } from "./mock-instance";

const DIST = path.resolve(__dirname, "../dist-jarvis3");
const SHOTS = path.resolve(
  process.env.JARVIS3_SCREENSHOT_DIR ?? path.resolve(__dirname, "../e2e-artifacts/jarvis3"),
);

const RUNNING = "a1a1a1a1a1a1a1a1";
const PAUSED = "b2b2b2b2b2b2b2b2";
const BOBS = "c3c3c3c3c3c3c3c3";
const CAROLS = "d4d4d4d4d4d4d4d4";
const FIRST_PROMPT = "Draft the Q3 supplier summary";

function task(patch: Partial<TaskView> & Pick<TaskView, "id" | "userId" | "title">): TaskView {
  const t = "2026-10-08T12:00:00.000Z";
  return {
    model: "anthropic/claude-example",
    state: "running",
    busy: null,
    error: null,
    pausedReason: null,
    createdAt: t,
    updatedAt: t,
    connected: true,
    agentId: null,
    ...patch,
  };
}

function notice(id: string, text: string, taskId: string | null): NoticeView {
  return {
    id,
    kind: "task_failed",
    text,
    taskId,
    createdAt: "2026-10-08T12:00:00.000Z",
    read: false,
  };
}

let daemon: TaskDaemon;
let instance: MockInstance;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  mkdirSync(SHOTS, { recursive: true });
  daemon = await startTaskDaemon({ firstPrompt: FIRST_PROMPT, title: FIRST_PROMPT });
  instance = await startMockInstance({
    distDir: DIST,
    startDelayMs: 1_000,
    tasks: [
      task({ id: RUNNING, userId: "u-alice", title: FIRST_PROMPT, agentId: daemon.agentId }),
      task({
        id: PAUSED,
        userId: "u-alice",
        title: "Reconcile the September invoices",
        state: "paused",
        pausedReason: "idle",
        connected: false,
      }),
      task({ id: BOBS, userId: "u-bob", title: "Bob's private task", agentId: daemon.agentId }),
      task({
        id: CAROLS,
        userId: "u-carol",
        title: "Carol's supplier list",
        state: "archived",
        connected: false,
      }),
    ],
    daemons: { [RUNNING]: daemon, [BOBS]: daemon },
    // Carol was offboarded: her task is archived, her layer kept. Bob is at his machine-hour cap.
    users: [
      ...DEFAULT_USERS,
      { id: "u-carol", email: "carol@example.org", name: "Carol", role: "staff", isAdmin: false },
    ],
    userStatus: { "u-carol": "suspended" },
    capReached: ["u-bob"],
    tools: true,
    toolsCapReached: ["u-bob"],
    layers: {
      "u-carol": {
        instructions: "Quote prices in EUR.",
        skills: [],
        notes: [
          {
            id: "nc1",
            text: "Carol's customers are in Austria.",
            createdAt: "2026-10-01T00:00:00.000Z",
            source: "user",
            taskId: null,
          },
        ],
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    },
    notices: {
      "u-alice": [
        notice("n2", "Your monthly machine hours are used up; 1 task was paused.", PAUSED),
        notice("n1", "A task couldn't start.", null),
      ],
    },
  });
});

test.afterAll(async () => {
  await instance?.close();
  await daemon?.close();
});

async function signIn(context: BrowserContext, email: string): Promise<void> {
  await context.addCookies([{ name: "CF_Authorization", value: email, url: instance.url }]);
}

/**
 * Crossing Paseo's compact/desktop breakpoint remounts the route, so `prepare` (re-opening a
 * dialog, say) runs after each viewport change, before the capture.
 */
async function shoot(page: Page, name: string, prepare?: () => Promise<void>): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [label, width, height] of [
      ["phone", 390, 844],
      ["desktop", 1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(400);
      if (prepare) await prepare();
      await page.screenshot({ path: path.join(SHOTS, `${name}-${label}-${scheme}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 800 });
  // The size and scheme changes can remount the route a moment later (Paseo's layout), which
  // closes an open dialog or empties a form under the next step. Reload so the test carries on
  // from a settled page.
  await page.reload();
}

test.beforeEach(async ({ context }) => {
  await signIn(context, "alice@example.org");
});

test("lists only the user's own tasks, with state and Start for a paused one", async ({ page }) => {
  await page.goto(`${instance.url}/`);
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByTestId(`jarvis3-task-${RUNNING}`)).toContainText(FIRST_PROMPT);
  await expect(page.getByTestId(`jarvis3-task-state-${RUNNING}`)).toContainText("Working");
  await expect(page.getByTestId(`jarvis3-task-state-${PAUSED}`)).toContainText(
    "Paused after being idle",
  );
  await expect(page.getByTestId(`jarvis3-task-resume-${PAUSED}`)).toBeVisible();
  await expect(page.getByText("Bob's private task")).toHaveCount(0);
  // Paseo's own chrome stays out of this variant.
  await expect(page.getByText("Add host")).toHaveCount(0);
  await shoot(page, "task-list");
});

test("opens a task's chat through the instance's daemon proxy", async ({ page }) => {
  await page.goto(`${instance.url}/tasks`);
  await page.getByTestId(`jarvis3-task-open-${RUNNING}`).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${RUNNING}$`));
  await expect(page.getByTestId("jarvis3-chat")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("user-message").first()).toContainText(FIRST_PROMPT, {
    timeout: 60_000,
  });
  expect(instance.state.requests).toContain(`WS /api/tasks/${RUNNING}/daemon`);
  const input = page.getByRole("textbox", { name: "Message agent..." }).first();
  await expect(input).toBeEditable({ timeout: 30_000 });
  await input.fill("Add a table of the top five suppliers");
  await input.press("Enter");
  await expect(
    page.getByTestId("user-message").filter({ hasText: "top five suppliers" }),
  ).toBeVisible({
    timeout: 30_000,
  });
  // No git/review panels, terminal or host settings around the chat.
  await expect(page.getByTestId("workspace-header-title")).toHaveCount(0);
  await shoot(page, "chat");
});

test("New task: first prompt and model, then the task's page", async ({ page }) => {
  await page.goto(`${instance.url}/tasks`);
  await page.getByTestId("jarvis3-new-task").click();
  await expect(page.getByTestId("jarvis3-new-task-screen")).toBeVisible();
  await page
    .getByTestId("jarvis3-new-task-prompt")
    .fill("Summarise the onboarding handbook in one page");
  await shoot(page, "new-task");
  // shoot() reloads the page, so the form starts empty again after the screenshots.
  await expect(async () => {
    await page
      .getByTestId("jarvis3-new-task-prompt")
      .fill("Summarise the onboarding handbook in one page");
    await expect(page.getByTestId("jarvis3-new-task-submit")).toBeEnabled({ timeout: 2_000 });
  }).toPass();
  await page.getByTestId("jarvis3-new-task-submit").click();
  await expect(page).toHaveURL(/\/tasks\/new0+1$/);
  await expect(page.getByTestId("jarvis3-task-chat")).toContainText(
    "Summarise the onboarding handbook",
  );
  const created = instance.state.tasks.find((t) => t.title.startsWith("Summarise the onboarding"));
  expect(created?.model).toBe("anthropic/claude-example");
  await page.getByTestId("jarvis3-nav-tasks").filter({ visible: true }).click();
  await expect(page.getByTestId("jarvis3-tasks").filter({ visible: true })).toContainText(
    "Summarise the onboarding handbook",
  );
});

test("Start resumes a paused task", async ({ page }) => {
  await page.goto(`${instance.url}/tasks`);
  await page.getByTestId(`jarvis3-task-resume-${PAUSED}`).click();
  await expect(page.getByTestId(`jarvis3-task-state-${PAUSED}`)).not.toContainText("Paused", {
    timeout: 15_000,
  });
  expect(instance.state.requests).toContain(`POST /api/tasks/${PAUSED}/resume`);
});

test("My instructions & skills: edit, Reset to company default, Undo", async ({ page }) => {
  await page.goto(`${instance.url}/me/layer`);
  await expect(page.getByTestId("jarvis3-layer")).toBeVisible();
  await page.getByTestId("jarvis3-instructions").fill("Answer in German.");
  await page.getByTestId("jarvis3-instructions-save").click();
  await expect(page.getByTestId("jarvis3-layer-notice")).toContainText(
    "Applies from your next task",
  );

  await page.getByTestId("jarvis3-skill-add").click();
  await page.getByRole("textbox", { name: "Name" }).fill("invoices");
  await page
    .getByTestId("jarvis3-skill-body")
    .fill("---\nname: invoices\n---\nFile supplier invoices.");
  await page.getByTestId("jarvis3-skill-save").click();
  await expect(page.getByTestId("jarvis3-skill-invoices")).toBeVisible();
  await shoot(page, "layer");

  await page.getByTestId("jarvis3-reset").click();
  await expect(page.getByTestId("jarvis3-layer-dialog")).toBeVisible();
  const openResetDialog = async () => {
    if (!(await page.getByTestId("jarvis3-layer-dialog").isVisible())) {
      await page.getByTestId("jarvis3-reset").click();
    }
    await expect(page.getByTestId("jarvis3-layer-dialog")).toBeVisible();
  };
  await shoot(page, "layer-reset-dialog", openResetDialog);
  await openResetDialog();
  await page.getByTestId("jarvis3-layer-dialog-confirm").click();
  await expect(page.getByTestId("jarvis3-reset-banner")).toContainText("Reset to company default");
  await expect(page.getByTestId("jarvis3-skill-invoices")).toHaveCount(0);
  await expect(page.getByTestId("jarvis3-instructions")).toHaveValue("");

  await page.getByTestId("jarvis3-undo").click();
  await expect(page.getByTestId("jarvis3-skill-invoices")).toBeVisible();
  await expect(page.getByTestId("jarvis3-instructions")).toHaveValue("Answer in German.");
});

test("Suggest for everyone: a skill becomes a pull request with its link and state", async ({
  page,
}) => {
  await page.goto(`${instance.url}/me/layer`);
  const skill = page.getByTestId("jarvis3-skill-invoices");
  await expect(skill).toBeVisible();
  await skill.getByText("Suggest for everyone").click();
  await expect(page.getByTestId("jarvis3-suggest-dialog")).toBeVisible();
  await page.getByTestId("jarvis3-suggest-dialog-confirm").click();
  await expect(page.getByTestId("jarvis3-suggest-banner")).toContainText("pull request #1");
  await expect(skill.getByText("Suggested")).toBeVisible();
  await expect(page.getByTestId("jarvis3-my-suggestions")).toContainText('Skill "invoices" · #1');
  await expect(page.getByTestId("jarvis3-my-suggestions")).toContainText("Waiting for an admin");
  expect(instance.state.suggestions[0]).toMatchObject({ kind: "skill", name: "invoices" });
  await shoot(page, "layer-suggested");
});

test("another user's task is not found, and its daemon socket is refused", async ({ page }) => {
  await page.goto(`${instance.url}/tasks/${BOBS}`);
  await expect(page.getByText("This task doesn't exist, or isn't yours.")).toBeVisible();
  await expect(page.getByText("Bob's private task")).toHaveCount(0);
  const outcome = await page.evaluate(
    (url) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(url);
        ws.addEventListener("open", () => resolve("open"));
        ws.addEventListener("error", () => resolve("refused"));
      }),
    `${instance.url.replace("http", "ws")}/api/tasks/${BOBS}/daemon`,
  );
  expect(outcome).toBe("refused");
  await shoot(page, "not-found");
});

test("an admin sees users and their limits", async ({ page, context }) => {
  await context.clearCookies();
  await signIn(context, "admin@example.org");
  await page.goto(`${instance.url}/tasks`);
  await page.getByTestId("jarvis3-nav-admin").filter({ visible: true }).click();
  await expect(page.getByTestId("jarvis3-users")).toContainText("Alice");
  await expect(page.getByTestId("jarvis3-user-u-bob")).toContainText("USD 20.00");
  await expect(page.getByTestId("jarvis3-user-cap-u-bob")).toContainText("At cap");
  await expect(page.getByTestId("jarvis3-user-u-carol")).toContainText("suspended");
  await expect(page.getByTestId("jarvis3-all-suggestions")).toContainText("alice@example.org");
  // Tier 0 tools: web spend and proxy traffic, and Bob at his web-tools cap
  await expect(page.getByTestId("jarvis3-user-u-alice")).toContainText(
    "Web tools USD 0.0147 of USD 5.00 (3 calls); proxy 0.25 GB of 1 GB",
  );
  await expect(page.getByTestId("jarvis3-user-tools-cap-u-bob")).toContainText("Tools at cap");
  await shoot(page, "admin-users");

  // raise Bob's web-tools cap: the pill goes, the row says it is set for him
  await page.getByTestId("jarvis3-user-u-bob").getByText("Limits").click();
  await page.getByLabel("Web search and fetching per month (USD)").fill("20");
  await page.getByText("Save").click();
  await expect(page.getByTestId("jarvis3-user-u-bob")).toContainText(
    "Web tools USD 5.00 of USD 20.00 (set for this user)",
  );
  await expect(page.getByTestId("jarvis3-user-tools-cap-u-bob")).toHaveCount(0);
  expect(instance.state.requests).toContain("PATCH /api/users/u-bob/limits");

  // an offboarded person's archived task and kept personal layer
  const openCarol = async () => {
    const records = page.getByTestId("jarvis3-user-records-u-carol");
    if (!(await records.isVisible())) {
      await page.getByTestId("jarvis3-user-u-carol").getByText("Tasks & layer").click();
    }
    await expect(records).toContainText("Carol's supplier list");
  };
  await openCarol();
  const records = page.getByTestId("jarvis3-user-records-u-carol");
  await expect(records).toContainText("Quote prices in EUR.");
  await expect(records).toContainText("Carol's customers are in Austria.");
  await shoot(page, "admin-offboarded", openCarol);
  await openCarol();
  await page.getByTestId("jarvis3-user-records-u-carol").getByText("Download archive").click();
  await expect
    .poll(() => instance.state.requests.includes(`GET /api/tasks/${CAROLS}/archive`))
    .toBe(true);
});

test("staff don't see the admin section", async ({ page }) => {
  await page.goto(`${instance.url}/tasks`);
  await expect(page.getByTestId("jarvis3-nav-layer")).toBeVisible();
  await expect(page.getByTestId("jarvis3-nav-admin")).toHaveCount(0);
});

test("notices: the unread count is in the navigation and clears once they're seen", async ({
  page,
}) => {
  await page.goto(`${instance.url}/tasks`);
  const nav = page.getByTestId("jarvis3-nav-notices").filter({ visible: true });
  await expect(nav).toHaveText("Notices (2)");
  await nav.click();
  await expect(page.getByTestId("jarvis3-notice-list")).toContainText("machine hours are used up");
  await expect(page.getByTestId("jarvis3-notice-n2")).toContainText("New");
  await expect(nav).toHaveText("Notices");
  expect(instance.state.notices.get("u-alice")?.every((n) => n.read)).toBe(true);
  await shoot(page, "notices");
});

test("the HTTP relay reaches the task's daemon (downloads); another user's is refused", async ({
  page,
}) => {
  await page.goto(`${instance.url}/tasks`);
  const own = await page.request.get(`${instance.url}/api/tasks/${RUNNING}/daemon/http/api/status`);
  expect(own.status()).toBe(200);
  expect(own.headers()["content-disposition"]).toBe("attachment");
  expect(((await own.json()) as { status: string }).status).toBe("server_info");
  const theirs = await page.request.get(`${instance.url}/api/tasks/${BOBS}/daemon/http/api/status`);
  expect(theirs.status()).toBe(404);
});
