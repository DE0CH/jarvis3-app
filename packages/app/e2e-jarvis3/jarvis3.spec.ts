// The jarvis3 variant in a browser against a mock Jarvis 3 instance (mock-instance.ts) whose
// daemon proxy reaches a real Paseo daemon (daemon.ts). The chat app: it opens on an empty chat
// with the textbox focused; sending creates the chat, which shows in the sidebar at once; the
// answer has step chips that expand; Rename and Delete; a sleeping chat shows its history and
// wakes when you type; the sidebar reaches every screen, with admin items only for admins. Also
// My instructions & skills with Reset + Undo, notices with the unread count, "Suggest for
// everyone", usage this month, admin users (cap state, an offboarded person's chats, archive and
// layer), and another user's chat (not found, and its daemon socket and HTTP relay refused).
// Saves phone (390) and desktop (1440) screenshots in light and dark to JARVIS3_SCREENSHOT_DIR
// (default e2e-artifacts/jarvis3).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { NoticeView, TranscriptEntry } from "../src/jarvis3/api-types";
import { startTaskDaemon, type TaskDaemon } from "./daemon";
import {
  DEFAULT_USERS,
  startMockInstance,
  type MockInstance,
  type MockTaskInput,
} from "./mock-instance";

const DIST = path.resolve(__dirname, "../dist-jarvis3");
const SHOTS = path.resolve(
  process.env.JARVIS3_SCREENSHOT_DIR ?? path.resolve(__dirname, "../e2e-artifacts/jarvis3"),
);

const RUNNING = "a1a1a1a1a1a1a1a1";
const PAUSED = "b2b2b2b2b2b2b2b2";
const BOBS = "c3c3c3c3c3c3c3c3";
const CAROLS = "d4d4d4d4d4d4d4d4";
const FIRST_PROMPT = "Draft the Q3 supplier summary";
const NEW_PROMPT = "Summarise the onboarding handbook in one page";

function task(patch: Partial<MockTaskInput> & Pick<MockTaskInput, "id" | "userId" | "title">) {
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
  } satisfies MockTaskInput;
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

function history(agentId: string): TranscriptEntry[] {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 1, 9, m)).toISOString();
  return [
    { agentId, seq: 1, role: "user", text: "Reconcile the September invoices", at: at(0) },
    { agentId, seq: 2, role: "tool", text: "bash — ls invoices/ — sept.csv", at: at(1) },
    {
      agentId,
      seq: 3,
      role: "assistant",
      text: "All **42 invoices** match the ledger except two, listed below.",
      at: at(2),
    },
  ];
}

let daemon: TaskDaemon;
/** New chats' daemon: a longer mock stream that gets to its tool calls (read, grep, edit, bash). */
let stepsDaemon: TaskDaemon;
let instance: MockInstance;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  mkdirSync(SHOTS, { recursive: true });
  daemon = await startTaskDaemon({ firstPrompt: FIRST_PROMPT, title: FIRST_PROMPT });
  stepsDaemon = await startTaskDaemon({
    firstPrompt: NEW_PROMPT,
    title: NEW_PROMPT,
    model: "ten-second-stream",
  });
  const target = { url: daemon.url, password: daemon.password, agentId: daemon.agentId };
  instance = await startMockInstance({
    distDir: DIST,
    startDelayMs: 1_000,
    newTaskDaemon: {
      url: stepsDaemon.url,
      password: stepsDaemon.password,
      agentId: stepsDaemon.agentId,
    },
    tasks: [
      task({
        id: RUNNING,
        userId: "u-alice",
        title: FIRST_PROMPT,
        agentId: daemon.agentId,
        lastActivityAt: new Date().toISOString(),
      }),
      task({
        id: PAUSED,
        userId: "u-alice",
        title: "Reconcile the September invoices",
        state: "paused",
        pausedReason: "idle",
        connected: false,
        agentId: daemon.agentId,
        createdAt: "2026-10-01T09:00:00.000Z",
        lastActivityAt: "2026-10-01T09:02:00.000Z",
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
    daemons: { [RUNNING]: target, [BOBS]: target, [PAUSED]: target },
    transcripts: { [PAUSED]: history(daemon.agentId) },
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
        notice("n2", "Your monthly machine hours are used up; a chat was stopped.", PAUSED),
        notice("n1", "A chat couldn't start.", null),
      ],
    },
  });
});

test.afterAll(async () => {
  await instance?.close();
  await daemon?.close();
  await stepsDaemon?.close();
});

async function signIn(context: BrowserContext, email: string): Promise<void> {
  await context.addCookies([{ name: "CF_Authorization", value: email, url: instance.url }]);
}

const sidebar = (page: Page) => page.getByTestId("jarvis3-sidebar").filter({ visible: true });

/** On a phone the sidebar is a drawer behind the menu button. */
async function openDrawer(page: Page): Promise<void> {
  if (await sidebar(page).count()) return;
  await page.getByTestId("menu-button").filter({ visible: true }).first().click();
  await expect(sidebar(page)).toBeVisible();
}

/**
 * Phone (390) and desktop (1440), light and dark. Crossing Paseo's compact/desktop breakpoint
 * remounts the route, so `prepare` (re-opening a dialog, the drawer) runs after each change.
 */
async function shoot(
  page: Page,
  name: string,
  prepare?: (phone: boolean) => Promise<void>,
): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [label, width, height] of [
      ["phone", 390, 844],
      ["desktop", 1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(500);
      if (prepare) await prepare(label === "phone");
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, `${name}-${label}-${scheme}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
}

test.beforeEach(async ({ context, page }) => {
  await signIn(context, "alice@example.org");
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("opens on an empty chat with the textbox focused, and the user's own chats in the sidebar", async ({
  page,
}) => {
  await page.goto(`${instance.url}/`);
  await expect(page.getByTestId("jarvis3-new-chat-screen")).toBeVisible();
  await expect(page.getByTestId("jarvis3-composer-input")).toBeFocused();
  await expect(sidebar(page)).toContainText(FIRST_PROMPT);
  await expect(sidebar(page)).toContainText("Reconcile the September invoices");
  await expect(sidebar(page)).toContainText("Today");
  await expect(sidebar(page).getByText("Bob's private task")).toHaveCount(0);
  // Paseo's host chrome, and every machine word, stay out of this variant.
  await expect(page.getByText("Add host")).toHaveCount(0);
  for (const word of ["Paused", "Pause", "Resume", "Destroy", "Machine"]) {
    await expect(page.getByText(word, { exact: true })).toHaveCount(0);
  }
  await shoot(page, "new-chat");
  await shoot(page, "sidebar", async (phone) => {
    if (phone) await openDrawer(page);
  });
});

test("sending creates the chat, which shows in the sidebar at once; the answer has step chips", async ({
  page,
}) => {
  await page.goto(`${instance.url}/`);
  // the model picker in the composer
  await page.getByTestId("jarvis3-composer-model").click();
  await page.getByTestId("jarvis3-model-openai/gpt-example").click();
  await expect(page.getByTestId("jarvis3-composer-model")).toContainText("GPT (example)");
  const input = page.getByTestId("jarvis3-composer-input");
  await input.fill(NEW_PROMPT);
  await input.press("Enter");
  await expect(page).toHaveURL(/\/chats\/new0+1$/);
  const created = instance.state.tasks.find((t) => t.title === NEW_PROMPT);
  expect(created?.model).toBe("openai/gpt-example");
  await expect(page.getByTestId(`jarvis3-chat-row-${created?.id}`)).toBeVisible();
  await expect(page.getByTestId("jarvis3-chat-screen")).toContainText(NEW_PROMPT);
  await expect(page.getByTestId("jarvis3-chat-starting")).toBeVisible();
  await shoot(page, "chat-starting", async () => {
    // the screenshot pass can run past the start: whichever view is up is fine
  });

  // the agent answers in the live conversation; its tool calls are step chips that expand
  await expect(page.getByTestId("jarvis3-chat")).toBeVisible({ timeout: 60_000 });
  const chip = page.getByTestId("tool-call-badge").filter({ hasText: "Read a file" }).first();
  await expect(chip).toBeVisible({ timeout: 60_000 });
  await chip.click();
  await expect(page.getByText("conversation-list.tsx").first()).toBeVisible();
  await shoot(page, "chat-steps", async () => {
    await expect(page.getByTestId("jarvis3-chat")).toBeVisible({ timeout: 60_000 });
    const again = page.getByTestId("tool-call-badge").filter({ hasText: "Read a file" }).first();
    await again.scrollIntoViewIfNeeded();
    await again.click();
  });
  expect(instance.state.requests).toContain(`WS /api/tasks/${created?.id}/daemon`);
  // No git/review panels, terminal or host settings around the chat.
  await expect(page.getByTestId("workspace-header-title")).toHaveCount(0);
});

test("Rename (from the chat's menu) and Delete (from the sidebar)", async ({ page }) => {
  const created = instance.state.tasks.find((t) => t.title === NEW_PROMPT);
  const id = created?.id ?? "";
  await page.goto(`${instance.url}/chats/${id}`);
  await page.getByTestId("jarvis3-chat-menu").click();
  await page.getByTestId("jarvis3-chat-rename").click();
  await expect(page.getByTestId("jarvis3-rename-dialog")).toBeVisible();
  await page.getByTestId("jarvis3-rename-input").fill("Onboarding one-pager");
  await shoot(page, "chat-rename", async () => {
    if (!(await page.getByTestId("jarvis3-rename-dialog").isVisible())) {
      await page.getByTestId("jarvis3-chat-menu").click();
      await page.getByTestId("jarvis3-chat-rename").click();
    }
  });
  // shoot() reloads, and the layout can remount the route a moment later: let it settle first
  await expect(page.getByTestId("jarvis3-chat")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_500);
  await page.getByTestId("jarvis3-chat-menu").click();
  await page.getByTestId("jarvis3-chat-rename").click();
  await page.getByTestId("jarvis3-rename-input").fill("Onboarding one-pager");
  await page.getByTestId("jarvis3-rename-dialog-confirm").click();
  await expect(page.getByTestId(`jarvis3-chat-row-${id}`)).toContainText("Onboarding one-pager");
  expect(instance.state.requests).toContain(`PATCH /api/tasks/${id}`);

  await page.getByTestId(`jarvis3-chat-row-${id}`).hover();
  await page.getByTestId(`jarvis3-chat-menu-${id}`).click();
  await page.getByTestId(`jarvis3-chat-delete-${id}`).click();
  await expect(page.getByTestId("jarvis3-delete-dialog")).toContainText("Onboarding one-pager");
  await page.screenshot({ path: path.join(SHOTS, "chat-delete-desktop-light.png") });
  await page.getByTestId("jarvis3-delete-dialog-confirm").click();
  await expect(page).toHaveURL(new RegExp(`${instance.url}/$`));
  await expect(page.getByTestId(`jarvis3-chat-row-${id}`)).toHaveCount(0);
  expect(instance.state.requests).toContain(`DELETE /api/tasks/${id}`);
});

test("a sleeping chat shows its history, and wakes when you type", async ({ page }) => {
  await page.goto(`${instance.url}/chats/${PAUSED}`);
  await expect(page.getByTestId("jarvis3-history")).toContainText("42 invoices");
  await expect(
    page.getByTestId("tool-call-badge").filter({ hasText: "Ran a command" }),
  ).toBeVisible();
  await expect(page.getByText("Paused", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Start", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("jarvis3-chat-starting")).toHaveCount(0);
  await shoot(page, "chat-history");
  const reply = page.getByTestId("jarvis3-reply-input");
  await reply.fill("Which two don't match?");
  await reply.press("Enter");
  await expect(page.getByTestId("jarvis3-history")).toContainText("Which two don't match?");
  await expect(page.getByTestId("jarvis3-chat-starting")).toBeVisible();
  expect(instance.state.messages).toContainEqual(
    expect.objectContaining({ taskId: PAUSED, text: "Which two don't match?" }),
  );
  expect(instance.state.requests).not.toContain(`POST /api/tasks/${PAUSED}/resume`);
  await expect(page.getByTestId("jarvis3-chat")).toBeVisible({ timeout: 60_000 });
});

test("the sidebar reaches Approvals, Projects, Files, Schedules, Notices and Search", async ({
  page,
}) => {
  await page.goto(`${instance.url}/`);
  for (const [nav, screen] of [
    ["approvals", "jarvis3-approvals"],
    ["projects", "jarvis3-projects-screen"],
    ["files", "jarvis3-files-screen"],
    ["scheduled", "jarvis3-schedules"],
    ["notices", "jarvis3-notices"],
    ["search", "jarvis3-search-screen"],
  ] as const) {
    await sidebar(page).getByTestId(`jarvis3-nav-${nav}`).click();
    await expect(page.getByTestId(screen).filter({ visible: true }).first()).toBeVisible();
  }
  // on a phone, through the drawer
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${instance.url}/`);
  await openDrawer(page);
  await sidebar(page).getByTestId("jarvis3-nav-files").click();
  await expect(
    page.getByTestId("jarvis3-files-screen").filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(sidebar(page)).toHaveCount(0);
});

test("My instructions & skills: edit, Reset to company default, Undo", async ({ page }) => {
  await page.goto(`${instance.url}/me/layer`);
  await expect(page.getByTestId("jarvis3-layer")).toBeVisible();
  await page.getByTestId("jarvis3-instructions").fill("Answer in German.");
  await page.getByTestId("jarvis3-instructions-save").click();
  await expect(page.getByTestId("jarvis3-layer-notice")).toContainText(
    "Applies from your next chat",
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
  expect(instance.state.suggestions[0]).toMatchObject({ kind: "skill", name: "invoices" });
});

test("usage this month is in the profile menu", async ({ page }) => {
  await page.goto(`${instance.url}/`);
  await page.getByTestId("jarvis3-profile-menu").filter({ visible: true }).click();
  await expect(page.getByTestId("jarvis3-menu-admin")).toHaveCount(0);
  await page.getByTestId("jarvis3-menu-usage").click();
  await expect(page.getByTestId("jarvis3-my-usage-machine")).toBeVisible();
  await expect(page.getByTestId("jarvis3-my-usage-web")).toContainText(
    "USD 0.0147 of USD 5.00 (3 calls)",
  );
  await expect(page.getByTestId("jarvis3-my-usage-proxy")).toContainText("0.25 GB of 1 GB");
  await shoot(page, "usage");
  await shoot(page, "profile-menu", async (phone) => {
    await page.goto(`${instance.url}/`);
    if (phone) await openDrawer(page);
    await page.getByTestId("jarvis3-profile-menu").filter({ visible: true }).click();
  });
});

test("another user's chat is not found, and its daemon socket is refused", async ({ page }) => {
  await page.goto(`${instance.url}/chats/${BOBS}`);
  await expect(page.getByText("This chat doesn't exist, or isn't yours.")).toBeVisible();
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
  const renamed = await page.request.patch(`${instance.url}/api/tasks/${BOBS}`, {
    data: { title: "mine now" },
  });
  expect(renamed.status()).toBe(404);
});

test("an admin sees users and their limits, from the profile menu", async ({ page, context }) => {
  await context.clearCookies();
  await signIn(context, "admin@example.org");
  await page.goto(`${instance.url}/`);
  await page.getByTestId("jarvis3-profile-menu").filter({ visible: true }).click();
  await page.getByTestId("jarvis3-menu-admin").click();
  await expect(page.getByTestId("jarvis3-users")).toContainText("Alice");
  await expect(page.getByTestId("jarvis3-user-u-bob")).toContainText("USD 20.00");
  await expect(page.getByTestId("jarvis3-user-cap-u-bob")).toContainText("At cap");
  await expect(page.getByTestId("jarvis3-user-u-carol")).toContainText("suspended");
  await expect(page.getByTestId("jarvis3-all-suggestions")).toContainText("alice@example.org");
  await expect(page.getByTestId("jarvis3-user-u-alice")).toContainText(
    "Web tools USD 0.0147 of USD 5.00 (3 calls); proxy 0.25 GB of 1 GB",
  );
  await expect(page.getByTestId("jarvis3-user-tools-cap-u-bob")).toContainText("Tools at cap");
  await expect(page.getByTestId("jarvis3-tools-admin")).toContainText(
    "Everyone's web tools USD 5.01 of USD 100.00 (715 calls)",
  );
  await shoot(page, "admin-users");

  await page.getByTestId("jarvis3-user-u-bob").getByText("Limits").click();
  await page.getByLabel("Web search and fetching per month (USD)").fill("20");
  await page.getByText("Save").click();
  await expect(page.getByTestId("jarvis3-user-u-bob")).toContainText(
    "Web tools USD 5.00 of USD 20.00 (set for this user)",
  );
  expect(instance.state.requests).toContain("PATCH /api/users/u-bob/limits");

  // an offboarded person's deleted chat and kept personal layer
  await page.getByTestId("jarvis3-user-u-carol").getByText("Chats & layer").click();
  const records = page.getByTestId("jarvis3-user-records-u-carol");
  await expect(records).toContainText("Carol's supplier list");
  await expect(records).toContainText("Deleted");
  await expect(records).toContainText("Quote prices in EUR.");
  await records.getByText("Download archive").click();
  await expect
    .poll(() => instance.state.requests.includes(`GET /api/tasks/${CAROLS}/archive`))
    .toBe(true);
});

test("notices: the unread count is in the sidebar and clears once they're seen", async ({
  page,
}) => {
  await page.goto(`${instance.url}/`);
  await expect(sidebar(page).getByTestId("jarvis3-nav-notices-count")).toHaveText("2");
  await sidebar(page).getByTestId("jarvis3-nav-notices").click();
  await expect(page.getByTestId("jarvis3-notice-list")).toContainText("machine hours are used up");
  await expect(sidebar(page).getByTestId("jarvis3-nav-notices-count")).toHaveCount(0);
  expect(instance.state.notices.get("u-alice")?.every((n) => n.read)).toBe(true);
  await shoot(page, "notices");
});

test("the HTTP relay reaches the chat's daemon (downloads); another user's is refused", async ({
  page,
}) => {
  await page.goto(`${instance.url}/`);
  const own = await page.request.get(`${instance.url}/api/tasks/${RUNNING}/daemon/http/api/status`);
  expect(own.status()).toBe(200);
  expect(own.headers()["content-disposition"]).toBe("attachment");
  const theirs = await page.request.get(`${instance.url}/api/tasks/${BOBS}/daemon/http/api/status`);
  expect(theirs.status()).toBe(404);
});
