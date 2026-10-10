// Scheduled tasks, wakeups and channels in the jarvis3 web build against the mock instance (no
// daemon needed): the Schedules page, a new schedule with the server's preview (and its refusal of
// a too-frequent repeat), Run now, On/Off, Delete; a task's channel posts (marked read on opening)
// and its wakeups with Cancel; the task chat's one-line summary; a channel_post notice; another
// user can't open the channel. Saves phone (390) and desktop (1400) screenshots, light and dark,
// to JARVIS3_SCREENSHOT_DIR (default e2e-artifacts/jarvis3).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type {
  ChannelPostView,
  NoticeView,
  ScheduleDetail,
  TaskView,
  WakeupView,
} from "../src/jarvis3/api-types";
import { startMockInstance, type MockInstance } from "./mock-instance";

const DIST = path.resolve(__dirname, "../dist-jarvis3");
const SHOTS = path.resolve(
  process.env.JARVIS3_SCREENSHOT_DIR ?? path.resolve(__dirname, "../e2e-artifacts/jarvis3"),
);

const TASK = "e5e5e5e5e5e5e5e5";
const TASK_TITLE = "Supplier summary · 6 Oct 09:00";
const SCHEDULE = "sch-supplier";
const ADMIN_TASK = "a1a1a1a1a1a1a1a1";

let instance: MockInstance;

test.describe.configure({ mode: "serial" });

function fixtures() {
  const t = "2026-10-06T08:00:00.000Z";
  const task: TaskView = {
    id: TASK,
    userId: "u-alice",
    title: TASK_TITLE,
    model: "anthropic/claude-example",
    state: "paused",
    busy: null,
    error: null,
    pausedReason: "idle",
    createdAt: t,
    updatedAt: t,
    connected: false,
    agentId: null,
    scheduleId: SCHEDULE,
  };
  // the admin's own task, with an unread post: the Users page words it as just "unread"
  const adminTask: TaskView = {
    ...task,
    id: ADMIN_TASK,
    userId: "u-admin",
    title: "Admin's weekly check",
    scheduleId: null,
  };
  const schedule: ScheduleDetail = {
    id: SCHEDULE,
    userId: "u-alice",
    title: "Supplier summary",
    prompt: "Summarise last week's supplier emails and invoices for the finance team.",
    model: "anthropic/claude-example",
    cron: "0 9 * * MON",
    timeZone: "Europe/London",
    enabled: true,
    nextRunAt: "2026-10-13T08:00:00.000Z",
    lastRun: null,
    createdAt: "2026-09-29T10:00:00.000Z",
    updatedAt: "2026-09-29T10:00:00.000Z",
    runs: [
      {
        id: 2,
        scheduleId: SCHEDULE,
        dueAt: t,
        ranAt: t,
        manual: false,
        result: "started",
        taskId: TASK,
        error: null,
      },
      {
        id: 1,
        scheduleId: SCHEDULE,
        dueAt: "2026-09-29T08:00:00.000Z",
        ranAt: "2026-09-29T08:00:00.000Z",
        manual: false,
        result: "skipped_cap",
        taskId: null,
        error: null,
      },
    ],
  };
  const posts: ChannelPostView[] = [
    {
      id: "p-old",
      taskId: TASK,
      userId: "u-alice",
      title: "Invoices checked",
      text: "All 14 invoices match their purchase orders.",
      createdAt: "2026-10-06T08:20:00.000Z",
      read: true,
    },
    {
      id: "p-new",
      taskId: TASK,
      userId: "u-alice",
      title: "Supplier summary, week 40",
      text: "## Week 40\n\n- **3** new suppliers onboarded\n- 2 contracts up for renewal in November\n- Late payment: *Example Freight Ltd* (12 days)\n\n| Supplier | Spend |\n|---|---|\n| Example Paper | £4,210 |\n| Example Freight | £2,980 |",
      createdAt: "2026-10-06T08:41:00.000Z",
      read: false,
    },
    {
      id: "p-admin",
      taskId: ADMIN_TASK,
      userId: "u-admin",
      title: "Weekly check done",
      text: "Nothing to report.",
      createdAt: "2026-10-06T09:00:00.000Z",
      read: false,
    },
  ];
  const wakeup = (patch: Partial<WakeupView>): WakeupView => ({
    id: "w",
    taskId: TASK,
    userId: "u-alice",
    name: "default",
    kind: "time",
    prompt: "",
    failPrompt: null,
    at: null,
    cron: null,
    timeZone: null,
    check: null,
    intervalSeconds: null,
    expiresAt: null,
    state: "armed",
    firedAt: null,
    lastError: null,
    checks: 0,
    createdAt: "2026-10-06T08:40:00.000Z",
    ...patch,
  });
  const wakeups: WakeupView[] = [
    wakeup({
      id: "w-reply",
      name: "supplier-reply",
      prompt: "Check whether Example Freight answered about the late payment; post what they said.",
      at: "2026-10-08T08:00:00.000Z",
    }),
    wakeup({
      id: "w-portal",
      name: "portal-status",
      kind: "check",
      prompt: "The supplier portal is back: download the October statements.",
      at: "2026-10-06T09:00:00.000Z",
      check: { url: "https://status.example.net/portal", contains: "operational" },
      intervalSeconds: 900,
      expiresAt: "2026-10-13T08:40:00.000Z",
      checks: 4,
    }),
    wakeup({
      id: "w-done",
      name: "first-look",
      prompt: "Look at the inbox again.",
      state: "fired",
      firedAt: "2026-10-06T08:30:00.000Z",
      createdAt: "2026-10-06T08:10:00.000Z",
    }),
  ];
  const notices: Record<string, NoticeView[]> = {
    "u-alice": [
      {
        id: "n-post",
        kind: "channel_post",
        text: `${TASK_TITLE}: Supplier summary, week 40`,
        taskId: TASK,
        createdAt: "2026-10-06T08:41:00.000Z",
        read: false,
      },
    ],
  };
  return { task, adminTask, schedule, posts, wakeups, notices };
}

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const f = fixtures();
  instance = await startMockInstance({
    distDir: DIST,
    startDelayMs: 1_000,
    tasks: [f.task, f.adminTask],
    schedules: [f.schedule],
    posts: f.posts,
    wakeups: f.wakeups,
    notices: f.notices,
  });
});

test.afterAll(async () => {
  await instance?.close();
});

async function signIn(context: BrowserContext, email: string): Promise<void> {
  await context.addCookies([{ name: "CF_Authorization", value: email, url: instance.url }]);
}

/** Phone and desktop, light and dark; `ready` waits for the page's content after each change. */
async function shoot(page: Page, name: string, ready: () => Promise<void>): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [label, width, height] of [
      ["phone", 390, 1100],
      ["desktop", 1400, 1000],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(400);
      await ready();
      await page.screenshot({
        path: path.join(SHOTS, `schedules-${name}-${label}-${scheme}.png`),
        fullPage: true,
      });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 900 });
  // Crossing Paseo's compact/desktop breakpoint remounts the route; carry on from a settled page.
  await page.reload();
  await ready();
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${label}: `) }).click();
  await page.getByText(option, { exact: true }).last().click();
}

test("the schedules page, a new schedule with its preview, Run now, On/Off, Delete", async ({
  page,
  context,
}) => {
  await signIn(context, "alice@example.org");
  await page.goto(`${instance.url}/tasks`);
  await page.getByTestId("jarvis3-nav-schedules").click();
  await expect(page).toHaveURL(/\/scheduled$/);
  const row = page.getByTestId(`jarvis3-schedule-${SCHEDULE}`);
  await expect(row).toContainText("Supplier summary");
  await expect(row).toContainText("Every Monday at 09:00 · Europe/London");
  await expect(row).toContainText("Last run");
  await expect(row).toContainText("Started");
  await shoot(page, "list", () => expect(row).toBeVisible());

  // A new schedule: every day at 07:30 in Asia/Tokyo; the preview comes from the server.
  await page.getByTestId("jarvis3-new-schedule").click();
  await expect(page).toHaveURL(/\/scheduled\/new$/);
  await page.getByLabel("Title", { exact: true }).fill("Morning inbox digest");
  await page
    .getByTestId("jarvis3-schedule-prompt")
    .fill("Read my inbox from the last 24 hours and post a short digest of what needs me.");
  await choose(page, "Repeat", "Every day");
  await page.getByLabel("Time", { exact: true }).fill("07:30");
  await page.getByLabel("Time zone", { exact: true }).fill("Asia/Tokyo");
  const preview = page.getByTestId("jarvis3-schedule-preview");
  await expect(preview).toContainText("Next runs");
  await expect(preview).toContainText("07:30");
  await shoot(page, "new", async () => {
    // a remount loses the typed fields: fill them again after each size change
    const prompt = page.getByTestId("jarvis3-schedule-prompt");
    if ((await prompt.inputValue()) === "") {
      await page.getByLabel("Title", { exact: true }).fill("Morning inbox digest");
      await prompt.fill(
        "Read my inbox from the last 24 hours and post a short digest of what needs me.",
      );
      await choose(page, "Repeat", "Every day");
      await page.getByLabel("Time", { exact: true }).fill("07:30");
      await page.getByLabel("Time zone", { exact: true }).fill("Asia/Tokyo");
    }
    await expect(preview).toContainText("07:30");
  });

  // Too often: the server's limit shows under the field, and nothing is saved.
  await choose(page, "Repeat", "Custom (cron)");
  await page.getByLabel("Cron expression", { exact: true }).fill("*/5 * * * *");
  await expect(page.getByTestId("jarvis3-schedule-preview-error")).toContainText(
    "at most every 60 minutes",
  );
  await page.getByTestId("jarvis3-schedule-save").click();
  await expect(page).toHaveURL(/\/scheduled\/new$/);
  await page.getByLabel("Cron expression", { exact: true }).fill("30 7 * * *");
  await expect(preview).toContainText("07:30");
  await page.getByTestId("jarvis3-schedule-save").click();
  await expect(page).toHaveURL(/\/scheduled\/sch[0-9a-f]+$/);
  const created = instance.state.schedules.find((s) => s.title === "Morning inbox digest");
  expect(created).toMatchObject({ cron: "30 7 * * *", timeZone: "Asia/Tokyo", enabled: true });
  await expect(page.getByTestId("jarvis3-schedule-status")).toContainText("Next:");

  // Run now starts a task with the schedule's prompt; a second one is skipped (one at a time).
  await page.getByTestId("jarvis3-schedule-run").click();
  await expect(page.getByTestId("jarvis3-schedule-ran")).toContainText("Started a new task.");
  const run = instance.state.tasks.find((t) => t.scheduleId === created?.id);
  expect(run?.title).toBe("Morning inbox digest · now");
  await page.getByTestId("jarvis3-schedule-run").click();
  await expect(page.getByTestId("jarvis3-schedule-ran")).toContainText(
    "Skipped: the previous run was still going",
  );
  await expect(page.getByTestId("jarvis3-schedule-runs")).toContainText("started by hand");
  await shoot(page, "detail", () =>
    expect(page.getByTestId("jarvis3-schedule-runs")).toBeVisible(),
  );

  // Off from the list.
  await page.getByTestId("jarvis3-nav-schedules").click();
  await page.getByTestId(`jarvis3-schedule-toggle-${created?.id}`).click();
  await expect(page.getByTestId(`jarvis3-schedule-status-${created?.id}`)).toContainText("Off");
  expect(instance.state.schedules.find((s) => s.id === created?.id)?.enabled).toBe(false);

  // Delete, after a centered confirmation.
  // (a fresh load: the router keeps the earlier page of this schedule mounted in its stack)
  await page.goto(`${instance.url}/scheduled/${created?.id}`);
  await page.getByTestId("jarvis3-schedule-delete").click();
  await expect(page.getByTestId("jarvis3-schedule-delete-dialog")).toBeVisible();
  await page.getByTestId("jarvis3-schedule-delete-dialog-confirm").click();
  await expect(page).toHaveURL(/\/scheduled$/);
  await expect(page.getByTestId(`jarvis3-schedule-${created?.id}`)).toHaveCount(0);
  expect(instance.state.schedules.some((s) => s.id === created?.id)).toBe(false);
});

test("admin: a person's channels from the Users page, read-only, nothing marked read", async ({
  page,
  context,
}) => {
  await signIn(context, "admin@example.org");
  await page.goto(`${instance.url}/admin/users`);
  await page.getByTestId("jarvis3-user-u-alice").getByText("Tasks & layer").click();
  const records = page.getByTestId("jarvis3-user-records-u-alice");
  await expect(records).toContainText(TASK_TITLE);
  await expect(records).toContainText("2 posts, 1 unread by them");
  // on the admin's own row the same count is just "unread"
  await page.getByTestId("jarvis3-user-u-admin").getByText("Tasks & layer").click();
  const own = page.getByTestId("jarvis3-user-records-u-admin");
  await expect(own).toContainText("Admin's weekly check");
  await expect(own).toContainText("1 post, 1 unread");
  await expect(own).not.toContainText("unread by them");
  await page.getByTestId(`jarvis3-user-channel-${TASK}`).click();
  await expect(page).toHaveURL(new RegExp(`/channels/${TASK}$`));
  await expect(page.getByTestId("jarvis3-channel-posts")).toContainText(
    "Supplier summary, week 40",
  );
  const banner = page.getByTestId("jarvis3-channel-read-only");
  await expect(banner).toBeVisible();
  await expect(page.getByTestId("jarvis3-wakeups")).toContainText("supplier-reply");
  await expect(page.getByTestId("jarvis3-wakeup-cancel-w-reply")).toHaveCount(0);
  await expect(page.getByTestId("jarvis3-channel-open-chat")).toHaveCount(0);
  await expect(page.getByTestId("jarvis3-wake-open")).toHaveCount(0);
  await shoot(page, "channel-admin", () => expect(banner).toBeVisible());
  // reading it changed nothing for alice
  expect(instance.state.requests).not.toContain(`POST /api/tasks/${TASK}/posts/read`);
  expect(instance.state.posts.find((p) => p.id === "p-new")?.read).toBe(false);
  await context.clearCookies();
});

test("a task's channel and wakeups: posts read on opening, cancel a wakeup", async ({
  page,
  context,
}) => {
  await signIn(context, "alice@example.org");
  await page.goto(`${instance.url}/tasks`);
  const channelButton = page.getByTestId(`jarvis3-task-channel-${TASK}`);
  await expect(channelButton).toHaveText("1 new post");
  await expect(page.getByTestId(`jarvis3-task-${TASK}`)).toContainText("From a schedule");

  // The chat's one-line summary links to the channel.
  await page.getByTestId(`jarvis3-task-open-${TASK}`).click();
  const extras = page.getByTestId("jarvis3-chat-extras");
  await expect(extras).toContainText("2 posts (1 new)");
  await expect(extras).toContainText("2 wakeups, next");
  await shoot(page, "chat-line", () => expect(extras).toBeVisible());
  await page.getByTestId("jarvis3-chat-channel").click();
  await expect(page).toHaveURL(new RegExp(`/channels/${TASK}$`));

  const posts = page.getByTestId("jarvis3-channel-posts");
  await expect(posts).toContainText("Supplier summary, week 40");
  await expect(posts).toContainText("new suppliers onboarded");
  await expect(posts).toContainText("Example Paper");
  const wakeups = page.getByTestId("jarvis3-wakeups");
  await expect(wakeups).toContainText("supplier-reply");
  await expect(wakeups).toContainText(
    'When https://status.example.net/portal contains "operational", checked every 15 minutes',
  );
  await expect(wakeups).toContainText("Delivered");
  await expect.poll(() => instance.state.posts.find((p) => p.id === "p-new")?.read).toBe(true);
  await shoot(page, "channel", () => expect(posts).toBeVisible());

  await page.getByTestId("jarvis3-wakeup-cancel-w-reply").click();
  await expect(page.getByTestId("jarvis3-wakeup-cancel-dialog")).toBeVisible();
  await page.getByTestId("jarvis3-wakeup-cancel-dialog-confirm").click();
  await expect(page.getByTestId("jarvis3-wakeup-w-reply")).toContainText("Cancelled");
  await expect(page.getByTestId("jarvis3-wakeup-cancel-w-reply")).toHaveCount(0);
  expect(instance.state.wakeups.find((w) => w.id === "w-reply")?.state).toBe("cancelled");

  await page.goto(`${instance.url}/tasks`);
  await expect(page.getByTestId(`jarvis3-task-channel-${TASK}`)).toHaveText("Channel");
});

test("Wake this task at…: the owner arms a timed wakeup with a message", async ({
  page,
  context,
}) => {
  await signIn(context, "alice@example.org");
  await page.goto(`${instance.url}/channels/${TASK}`);
  const open = page.getByTestId("jarvis3-wake-open");
  await expect(open).toBeVisible();
  const openDialog = async () => {
    await page.getByTestId("jarvis3-wake-open").click();
    await expect(page.getByTestId("jarvis3-wake-dialog")).toBeVisible();
  };
  await openDialog();
  await shoot(page, "wake-dialog", async () => {
    if (!(await page.getByTestId("jarvis3-wake-dialog").isVisible())) await openDialog();
    await expect(page.getByRole("textbox", { name: "Date", exact: true })).toBeVisible();
  });
  if (!(await page.getByTestId("jarvis3-wake-dialog").isVisible())) await openDialog();

  // a time that has passed is refused in the dialog, before anything is sent
  await page.getByRole("textbox", { name: "Date", exact: true }).fill("2020-01-01");
  await page.getByTestId("jarvis3-wake-dialog-confirm").click();
  await expect(page.getByTestId("jarvis3-wake-error")).toContainText("has passed");
  expect(instance.state.requests).not.toContain(`POST /api/tasks/${TASK}/wakeups`);

  // tomorrow at 09:30, the device's clock
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
  await page.getByRole("textbox", { name: "Date", exact: true }).fill(date);
  await page.getByRole("textbox", { name: "Time", exact: true }).fill("09:30");
  await page.getByRole("textbox", { name: "Message for the agent" }).fill("Check whether Example Freight paid.");
  await page.getByTestId("jarvis3-wake-dialog-confirm").click();
  await expect(page.getByTestId("jarvis3-wake-dialog")).toHaveCount(0);
  const armed = instance.state.wakeups.find((w) => w.setBy === "owner");
  expect(armed?.prompt).toBe("Check whether Example Freight paid.");
  const expected = new Date(
    tomorrow.getFullYear(),
    tomorrow.getMonth(),
    tomorrow.getDate(),
    9,
    30,
  ).toISOString();
  expect(armed?.at).toBe(expected);
  const row = page.getByTestId(`jarvis3-wakeup-${armed?.id}`);
  await expect(row).toContainText("(set by you)");
  await expect(row).toContainText("Check whether Example Freight paid.");
  await expect(page.getByTestId(`jarvis3-wakeup-cancel-${armed?.id}`)).toBeVisible();

  // someone else's task: no such task for them
  await context.clearCookies();
  await signIn(context, "bob@example.org");
  await page.goto(`${instance.url}/channels/${TASK}`);
  await expect(page.getByText("This task doesn't exist, or isn't yours.")).toBeVisible();
  await expect(page.getByTestId("jarvis3-wake-open")).toHaveCount(0);
});

test("a new post's notice opens the channel; another user can't open it", async ({
  page,
  context,
}) => {
  instance.addPost(TASK, "Statements downloaded", "October statements are in `statements/`.");
  await signIn(context, "alice@example.org");
  await page.goto(`${instance.url}/notices`);
  const notice = page.getByTestId("jarvis3-notice-list");
  await expect(notice).toContainText(`${TASK_TITLE}: Statements downloaded`);
  await notice.getByRole("button", { name: "Read" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/channels/${TASK}$`));
  await expect(page.getByTestId("jarvis3-channel-posts")).toContainText("Statements downloaded");

  await context.clearCookies();
  await signIn(context, "bob@example.org");
  await page.goto(`${instance.url}/channels/${TASK}`);
  await expect(page.getByText("This task doesn't exist, or isn't yours.")).toBeVisible();
  await expect(page.getByText("Statements downloaded")).toHaveCount(0);
  await page.goto(`${instance.url}/scheduled`);
  await expect(page.getByText("No schedules yet")).toBeVisible();
});
