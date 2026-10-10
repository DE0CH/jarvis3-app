// Files, first-prompt attachments and transcript search in the jarvis3 web build against the
// mock instance (no daemon needed): upload into a folder, list, download, rename/move and delete
// a file; New task with an attachment (the path reaches POST /api/tasks); search finds a seeded
// transcript, a hit opens the reader around it with older/newer paging; another user sees none
// of alice's files or hits (404 on her files, no hits), and an admin can search everyone.
// Saves phone (390) and desktop (1440) screenshots in light and dark to JARVIS3_SCREENSHOT_DIR.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { TaskView, TranscriptEntry } from "../src/jarvis3/api-types";
import { startMockInstance, type MockInstance } from "./mock-instance";

const DIST = path.resolve(__dirname, "../dist-jarvis3");
const SHOTS = path.resolve(
  process.env.JARVIS3_SCREENSHOT_DIR ?? path.resolve(__dirname, "../e2e-artifacts/jarvis3"),
);

const ARCHIVED = "e5e5e5e5e5e5e5e5";
const BOBS = "f6f6f6f6f6f6f6f6";
const AGENT = "agent-main";

let instance: MockInstance;

function task(patch: Partial<TaskView> & Pick<TaskView, "id" | "userId" | "title">): TaskView {
  const t = "2026-10-08T12:00:00.000Z";
  return {
    model: "anthropic/claude-example",
    state: "archived",
    busy: null,
    error: null,
    pausedReason: null,
    createdAt: t,
    updatedAt: t,
    connected: false,
    agentId: AGENT,
    ...patch,
  };
}

function conversation(lines: [TranscriptEntry["role"], string][]): TranscriptEntry[] {
  return lines.map(([role, text], i) => ({
    agentId: AGENT,
    seq: i + 1,
    role,
    text,
    at: new Date(Date.UTC(2026, 9, 8, 12, i)).toISOString(),
  }));
}

function filler(from: number, n: number): [TranscriptEntry["role"], string][] {
  const out: [TranscriptEntry["role"], string][] = [];
  for (let i = 0; i < n; i++) out.push(["assistant", `Working note ${from + i}.`]);
  return out;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  instance = await startMockInstance({
    distDir: DIST,
    startDelayMs: 500,
    tasks: [
      task({ id: ARCHIVED, userId: "u-alice", title: "Reconcile the September invoices" }),
      task({ id: BOBS, userId: "u-bob", title: "Bob's private task" }),
    ],
    transcripts: {
      [ARCHIVED]: conversation([
        ...filler(1, 30),
        ["user", "Which supplier sent the duplicate invoice in September?"],
        ["tool", 'bash: rg -i "duplicate" invoices/ → invoices/acme-0917.pdf'],
        ["assistant", "Acme Ltd sent the duplicate invoice (ACME-0917); I flagged it."],
        ...filler(31, 30),
      ]),
      [BOBS]: conversation([["user", "Bob's secret duplicate invoice plan"]]),
    },
    files: {
      "u-alice": [
        { path: "reports/q3.txt", text: "Q3 numbers" },
        { path: "summary.md", text: "# Summary", source: "session" },
      ],
      "u-bob": [{ path: "bob-only.txt", text: "Bob's file" }],
    },
    maxFileBytes: 1024,
  });
});

test.afterAll(async () => {
  await instance?.close();
});

async function signIn(context: BrowserContext, email: string): Promise<void> {
  await context.addCookies([{ name: "CF_Authorization", value: email, url: instance.url }]);
}

/** Phone and desktop, light and dark; `ready` waits for the content after each size change. */
async function shoot(page: Page, name: string, ready: () => Promise<void>): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [label, width, height] of [
      ["phone", 390, 900],
      ["desktop", 1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(400);
      await ready();
      await page.screenshot({ path: path.join(SHOTS, `${name}-${label}-${scheme}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 900 });
  // Crossing Paseo's compact/desktop breakpoint remounts the route; carry on from a settled page.
  await page.reload();
  await ready();
}

const visible = (page: Page, testID: string) => page.getByTestId(testID).filter({ visible: true });

async function uploadThroughPicker(page: Page, button: string, name: string, text: string) {
  const chooser = page.waitForEvent("filechooser");
  await visible(page, button).click();
  await (await chooser).setFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
}

test("files: browse, upload, download, rename into a folder, delete", async ({ page, context }) => {
  await signIn(context, "alice@example.org");
  await page.goto(`${instance.url}/tasks`);
  await visible(page, "jarvis3-nav-files").click();
  await expect(page).toHaveURL(/\/files$/);
  const list = () => visible(page, "jarvis3-files-list");
  await expect(list()).toContainText("reports/");
  await expect(list()).toContainText("summary.md");
  await expect(list()).toContainText("Saved by a task");
  await expect(visible(page, "jarvis3-files-usage")).toContainText("used");
  await shoot(page, "files", () => expect(list()).toContainText("summary.md"));

  // a folder, and back through the breadcrumb
  await visible(page, "jarvis3-folder-reports").click();
  await expect(page).toHaveURL(/dir=reports/);
  await expect(list()).toContainText("q3.txt");
  await visible(page, "jarvis3-files-crumbs").getByText("Files").click();
  await expect(list()).toContainText("summary.md");

  // upload
  await uploadThroughPicker(page, "jarvis3-files-upload", "notes.txt", "hello from alice");
  await expect(visible(page, "jarvis3-files-uploads")).toContainText("Uploaded");
  await expect(list()).toContainText("notes.txt");
  const stored = instance.state.files.get("u-alice")?.get("notes.txt");
  expect(stored?.bytes.toString()).toBe("hello from alice");
  expect(stored?.view.contentType).toBe("text/plain");

  // over the per-file limit: refused before upload, with the reason
  await uploadThroughPicker(page, "jarvis3-files-upload", "big.bin", "x".repeat(2048));
  await expect(visible(page, "jarvis3-files-uploads")).toContainText("limited to 1.0 KB");
  await visible(page, "jarvis3-files-uploads-dismiss").click();

  // download: a short-lived link, opened in a new tab; the link serves the bytes
  const links = instance.state.fileLinks.length;
  await visible(page, "jarvis3-file-download-notes.txt").click();
  await expect.poll(() => instance.state.fileLinks.length).toBe(links + 1);
  const link = instance.state.fileLinks.at(-1);
  expect(link?.path).toBe("notes.txt");
  const fetched = await page.request.get(link?.url ?? "");
  expect(await fetched.text()).toBe("hello from alice");

  // rename into a folder
  await visible(page, "jarvis3-file-move-notes.txt").click();
  const name = page.getByRole("textbox", { name: "New name" }).filter({ visible: true });
  await name.fill("archive/2026/notes.txt");
  await visible(page, "jarvis3-file-move-save").click();
  await expect(list()).toContainText("archive/");
  await expect(list()).not.toContainText("notes.txt");
  expect(instance.state.files.get("u-alice")?.has("archive/2026/notes.txt")).toBe(true);

  // delete it (centered confirmation); its emptied folder goes away
  await page.goto(`${instance.url}/files?dir=archive%2F2026`);
  await expect(list()).toContainText("notes.txt");
  await visible(page, "jarvis3-file-delete-archive/2026/notes.txt").click();
  await expect(page.getByTestId("jarvis3-file-delete-dialog")).toBeVisible();
  await page.getByTestId("jarvis3-file-delete-dialog-confirm").click();
  await expect(page).toHaveURL(/\/files$/);
  await expect(list()).not.toContainText("archive/");
  expect(instance.state.files.get("u-alice")?.has("archive/2026/notes.txt")).toBe(false);
});

test("New task: an attached file is uploaded and its path goes with the first prompt", async ({
  page,
  context,
}) => {
  await signIn(context, "alice@example.org");
  await page.goto(`${instance.url}/tasks/new`);
  await expect(page.getByTestId("jarvis3-new-task-screen")).toBeVisible();
  await uploadThroughPicker(page, "jarvis3-new-task-attach", "brief.txt", "the brief");
  await expect(visible(page, "jarvis3-new-task-attachments")).toContainText("brief.txt");
  await shoot(page, "new-task-attachments", async () => {
    await expect(page.getByTestId("jarvis3-new-task-screen")).toBeVisible();
  });
  // shoot() reloads: pick the file again and fill the prompt
  await uploadThroughPicker(page, "jarvis3-new-task-attach", "brief.txt", "the brief");
  await expect(visible(page, "jarvis3-attachment-0")).toContainText("brief.txt");
  await expect(async () => {
    await visible(page, "jarvis3-new-task-prompt").fill("Turn the attached brief into a plan");
    await expect(visible(page, "jarvis3-new-task-submit")).toBeEnabled({ timeout: 2_000 });
  }).toPass();
  await visible(page, "jarvis3-new-task-submit").click();
  await expect(page).toHaveURL(/\/tasks\/new0+1$/);
  const request = instance.state.createRequests.at(-1);
  expect(request?.attachments).toHaveLength(1);
  const attached = request?.attachments?.[0] ?? "";
  expect(attached).toMatch(/^attachments\/[A-Za-z0-9_-]+\/brief\.txt$/);
  expect(instance.state.files.get("u-alice")?.get(attached)?.bytes.toString()).toBe("the brief");
  expect(request?.requestId && attached.includes(request.requestId)).toBe(true);
});

test("New task: files already in Files are attached by path, with a fresh upload", async ({
  page,
  context,
}) => {
  await signIn(context, "alice@example.org");
  const openChooser = async () => {
    await expect(page.getByTestId("jarvis3-new-task-screen")).toBeVisible();
    await visible(page, "jarvis3-new-task-from-files").click();
    await expect(visible(page, "jarvis3-from-files-dialog")).toBeVisible();
    await expect(visible(page, "jarvis3-from-files-reports/q3.txt")).toBeVisible();
  };
  // screenshots of the chooser: phone and desktop, light and dark
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [label, width, height] of [
      ["phone", 390, 900],
      ["desktop", 1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`${instance.url}/tasks/new`);
      await openChooser();
      await visible(page, "jarvis3-from-files-summary.md").click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, `new-task-from-files-${label}-${scheme}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${instance.url}/tasks/new`);
  await openChooser();
  const dialog = visible(page, "jarvis3-from-files-dialog");
  // newest first; the filter narrows on any part of the path
  await expect(dialog).toContainText("summary.md");
  await page.getByRole("textbox", { name: "Filter your files" }).filter({ visible: true }).fill("REPORTS");
  await expect(visible(page, "jarvis3-from-files-summary.md")).toHaveCount(0);
  await visible(page, "jarvis3-from-files-reports/q3.txt").click();
  await expect(visible(page, "jarvis3-from-files-dialog-confirm")).toHaveText("Attach 1 file");
  await visible(page, "jarvis3-from-files-dialog-confirm").click();
  await expect(visible(page, "jarvis3-from-files-dialog")).toHaveCount(0);
  await expect(visible(page, "jarvis3-chosen-reports/q3.txt")).toContainText("In your Files");
  // a new file next to it, uploaded on submit
  await uploadThroughPicker(page, "jarvis3-new-task-attach", "fresh.txt", "fresh notes");
  await expect(visible(page, "jarvis3-attachment-0")).toContainText("fresh.txt");
  const uploadsBefore = instance.state.requests.filter((r) => r.startsWith("PUT ")).length;
  await expect(async () => {
    await visible(page, "jarvis3-new-task-prompt").fill("Compare the fresh notes with Q3");
    await expect(visible(page, "jarvis3-new-task-submit")).toBeEnabled({ timeout: 2_000 });
  }).toPass();
  await visible(page, "jarvis3-new-task-submit").click();
  await expect(page).toHaveURL(/\/tasks\/new0+2$/);
  const request = instance.state.createRequests.at(-1);
  expect(request?.attachments).toHaveLength(2);
  expect(request?.attachments?.[0]).toMatch(/^attachments\/[A-Za-z0-9_-]+\/fresh\.txt$/);
  expect(request?.attachments?.[1]).toBe("reports/q3.txt");
  // only the new file went up: the chosen one is attached by path
  const puts = instance.state.requests.filter((r) => r.startsWith("PUT ")).slice(uploadsBefore);
  expect(puts).toHaveLength(1);
  expect(puts[0]).toContain("fresh.txt");
});

test("search: finds a message in an archived task and opens the transcript around it", async ({
  page,
  context,
}) => {
  await signIn(context, "alice@example.org");
  await page.goto(`${instance.url}/tasks`);
  await visible(page, "jarvis3-nav-search").click();
  await expect(page).toHaveURL(/\/search$/);
  const box = page.getByRole("textbox", { name: "Search your tasks" }).filter({ visible: true });
  await box.fill("duplicate invoice");
  await visible(page, "jarvis3-search-submit").click();
  const group = visible(page, `jarvis3-search-group-${ARCHIVED}`);
  await expect(group).toContainText("Reconcile the September invoices");
  await expect(group).toContainText("Acme Ltd sent the duplicate invoice");
  await expect(visible(page, "jarvis3-search-results")).not.toContainText("Bob");
  await expect(visible(page, "jarvis3-search-everyone")).toHaveCount(0);
  await shoot(page, "search", async () => {
    await page
      .getByRole("textbox", { name: "Search your tasks" })
      .filter({ visible: true })
      .fill("duplicate invoice");
    await visible(page, "jarvis3-search-submit").click();
    await expect(visible(page, "jarvis3-search-results")).toBeVisible();
  });

  // the assistant's answer is message 33
  await visible(page, `jarvis3-search-hit-${ARCHIVED}-33`).click();
  await expect(page).toHaveURL(new RegExp(`/search/${ARCHIVED}\\?around=33&agentId=${AGENT}`));
  await expect(visible(page, "jarvis3-transcript-focused")).toContainText("Acme Ltd");
  // the page opens scrolled to the hit, 25 messages down
  await expect(visible(page, "jarvis3-transcript-focused")).toBeInViewport();
  await expect(visible(page, "jarvis3-transcript")).toContainText("Which supplier sent");
  await expect(visible(page, "jarvis3-transcript-open-chat")).toHaveCount(0); // archived
  await expect(visible(page, "jarvis3-transcript")).not.toContainText("Working note 1.");
  await visible(page, "jarvis3-transcript-older").click();
  await expect(visible(page, "jarvis3-transcript")).toContainText("Working note 1.");
  await expect(visible(page, "jarvis3-transcript-older")).toHaveCount(0);
  await visible(page, "jarvis3-transcript-newer").click();
  await expect(visible(page, "jarvis3-transcript")).toContainText("Working note 60.");
  await shoot(page, "transcript", async () => {
    await expect(visible(page, "jarvis3-transcript-focused")).toContainText("Acme Ltd");
    await expect(visible(page, "jarvis3-transcript-focused")).toBeInViewport();
  });
});

test("another user sees none of alice's files or hits; an admin can search everyone", async ({
  page,
  context,
  request,
}) => {
  const asBob = { "Cf-Access-Authenticated-User-Email": "bob@example.org" };
  const aliceFiles = await request.get(`${instance.url}/api/users/u-alice/files`, {
    headers: asBob,
  });
  expect(aliceFiles.status()).toBe(404);
  const aliceFile = await request.get(`${instance.url}/api/users/u-alice/files/summary.md?link=1`, {
    headers: asBob,
  });
  expect(aliceFile.status()).toBe(404);
  const put = await request.put(`${instance.url}/api/users/u-alice/files/x.txt`, {
    headers: asBob,
    data: "nope",
  });
  expect(put.status()).toBe(404);
  const transcript = await request.get(`${instance.url}/api/tasks/${ARCHIVED}/transcript`, {
    headers: asBob,
  });
  expect(transcript.status()).toBe(404);
  const everyone = await request.get(`${instance.url}/api/search?q=invoice&all=1`, {
    headers: asBob,
  });
  expect(everyone.status()).toBe(404);

  await signIn(context, "bob@example.org");
  await page.goto(`${instance.url}/files`);
  await expect(visible(page, "jarvis3-files-list")).toContainText("bob-only.txt");
  await expect(visible(page, "jarvis3-files-list")).not.toContainText("summary.md");
  await page.goto(`${instance.url}/search`);
  const box = page.getByRole("textbox", { name: "Search your tasks" }).filter({ visible: true });
  await box.fill("duplicate invoice");
  // Enter in the box searches, like the button
  await box.press("Enter");
  await expect(visible(page, `jarvis3-search-group-${BOBS}`)).toBeVisible();
  await expect(visible(page, `jarvis3-search-group-${ARCHIVED}`)).toHaveCount(0);

  // the admin: "Everyone's tasks" finds both, and alice's files open read-only
  await context.clearCookies();
  await signIn(context, "admin@example.org");
  await page.goto(`${instance.url}/search`);
  await page
    .getByRole("textbox", { name: "Search your tasks" })
    .filter({ visible: true })
    .fill("duplicate invoice");
  await visible(page, "jarvis3-search-everyone").click();
  await visible(page, "jarvis3-search-submit").click();
  await expect(visible(page, `jarvis3-search-group-${ARCHIVED}`)).toBeVisible();
  await expect(visible(page, `jarvis3-search-group-${BOBS}`)).toBeVisible();
  await page.goto(`${instance.url}/files?user=u-alice`);
  await expect(page.getByText("Files (read only)").filter({ visible: true })).toBeVisible();
  await expect(visible(page, "jarvis3-files-list")).toContainText("summary.md");
  await expect(visible(page, "jarvis3-files-upload")).toHaveCount(0);
});
