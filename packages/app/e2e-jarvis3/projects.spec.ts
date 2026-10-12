// Projects in the jarvis3 web build against the mock instance (no daemon needed): a person makes
// their own Project (a repo and a secret whose value is never shown again), picks it in the new
// chat's composer (the ids go with POST /api/tasks, the chat names them), a clash between two
// picked Projects is refused with the key named, a shared Project is read-only for staff and
// only for the roles it names, nobody sees another person's private Project, and an admin
// shares one with a role. Saves phone (390) and desktop (1440) screenshots in light and dark.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { startMockInstance, type MockInstance, type MockProject } from "./mock-instance";

const DIST = path.resolve(__dirname, "../dist-jarvis3");
const SHOTS = path.resolve(
  process.env.JARVIS3_SCREENSHOT_DIR ?? path.resolve(__dirname, "../e2e-artifacts/jarvis3"),
);
const SECRET = "ghp_example_never_shown_0123456789";

function project(patch: Partial<MockProject> & Pick<MockProject, "id" | "name">): MockProject {
  const t = "2026-10-11T09:00:00.000Z";
  return {
    description: "",
    ownerId: "u-alice",
    roles: [],
    repos: [],
    secrets: {},
    createdAt: t,
    updatedAt: t,
    ...patch,
  };
}

let instance: MockInstance;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const t = "2026-10-11T09:00:00.000Z";
  instance = await startMockInstance({
    distDir: DIST,
    startDelayMs: 600_000,
    projects: [
      project({
        id: "p-handbook",
        name: "Staff handbook",
        description: "The company handbook repo, for every staff chat.",
        ownerId: null,
        roles: ["staff"],
        repos: [{ url: "https://github.com/example/handbook.git", ref: null, tokenSecret: null }],
      }),
      project({
        id: "p-finance",
        name: "Finance exports",
        ownerId: null,
        roles: ["admin"],
        secrets: { BANK_API: { value: "admin-only-value", updatedAt: t } },
      }),
      project({
        id: "p-bob",
        name: "Bob's scripts",
        ownerId: "u-bob",
        secrets: { BOB_KEY: { value: "bob-value", updatedAt: t } },
      }),
      project({
        id: "p-reports",
        name: "Reports",
        secrets: { API_TOKEN: { value: "one", updatedAt: t } },
      }),
    ],
  });
});

test.afterAll(async () => {
  await instance?.close();
});

async function signIn(context: BrowserContext, email: string): Promise<void> {
  await context.clearCookies();
  await context.addCookies([{ name: "CF_Authorization", value: email, url: instance.url }]);
}

const visible = (page: Page, testID: string) => page.getByTestId(testID).filter({ visible: true });

async function shoot(page: Page, name: string, ready: () => Promise<void>): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [label, width, height] of [
      ["phone", 390, 844],
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
  await page.reload();
  await ready();
}

test("a person makes a Project with a repo and a secret; the value is never sent back", async ({
  page,
  context,
}) => {
  await signIn(context, "alice@example.org");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${instance.url}/`);
  await visible(page, "jarvis3-nav-projects").click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(visible(page, "jarvis3-projects-screen")).toContainText("Staff handbook");
  await expect(visible(page, "jarvis3-projects-screen")).toContainText("Reports");
  await expect(visible(page, "jarvis3-projects-screen")).not.toContainText("Finance exports");
  await expect(visible(page, "jarvis3-projects-screen")).not.toContainText("Bob's scripts");

  await visible(page, "jarvis3-new-project").click();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await visible(page, "jarvis3-project-name").fill("Website");
  await visible(page, "jarvis3-repo-add").click();
  await visible(page, "jarvis3-repo-url-0").fill("https://github.com/acme/site.git");
  await visible(page, "jarvis3-secret-add").click();
  await visible(page, "jarvis3-secret-key-0").fill("GH_TOKEN");
  await visible(page, "jarvis3-secret-value-0").fill(SECRET);
  await visible(page, "jarvis3-repo-token-0-GH_TOKEN").click();
  await page.screenshot({ path: path.join(SHOTS, "project-new-desktop-light.png") });
  await visible(page, "jarvis3-project-save").click();
  await expect(page).toHaveURL(/\/projects\/p[0-9a-f]+$/);
  const created = instance.state.projects.find((p) => p.name === "Website");
  expect(created?.repos[0]).toEqual({
    url: "https://github.com/acme/site.git",
    ref: null,
    tokenSecret: "GH_TOKEN",
  });
  expect(created?.secrets.GH_TOKEN?.value).toBe(SECRET);
  // the page shows the key, never the value
  await expect(visible(page, "jarvis3-secret-key-0")).toHaveText("GH_TOKEN");
  await expect(page.getByText(SECRET)).toHaveCount(0);
  const list = await page.request.get(`${instance.url}/api/projects`);
  expect(await list.text()).not.toContain(SECRET);
  await shoot(page, "project", async () => {
    await expect(visible(page, "jarvis3-project-screen")).toBeVisible();
  });
  await page.goto(`${instance.url}/projects`);
  await expect(visible(page, `jarvis3-project-${created?.id}`)).toContainText("1 repo · 1 secret");
  await shoot(page, "projects", async () => {
    await expect(visible(page, "jarvis3-projects-screen")).toContainText("Website");
  });
});

test("a shared Project is read-only for staff; another person's private one doesn't exist", async ({
  page,
  context,
}) => {
  await signIn(context, "alice@example.org");
  await page.goto(`${instance.url}/projects/p-handbook`);
  await expect(visible(page, "jarvis3-project-screen")).toContainText("An admin manages this");
  await expect(visible(page, "jarvis3-project-save")).toHaveCount(0);
  for (const id of ["p-bob", "p-finance"]) {
    const res = await page.request.get(`${instance.url}/api/projects/${id}`);
    expect(res.status()).toBe(404);
  }
  const edit = await page.request.patch(`${instance.url}/api/projects/p-handbook`, {
    data: { name: "mine" },
  });
  expect(edit.status()).toBe(403);
  const share = await page.request.post(`${instance.url}/api/projects`, {
    data: { name: "x", shared: true, roles: ["staff"] },
  });
  expect(share.status()).toBe(403);
});

test("the composer picks Projects; the chat names them; a clash is refused", async ({
  page,
  context,
}) => {
  await signIn(context, "alice@example.org");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${instance.url}/`);
  await visible(page, "jarvis3-composer-projects").click();
  const website = instance.state.projects.find((p) => p.name === "Website");
  await visible(page, `jarvis3-pick-project-${website?.id}`).click();
  await visible(page, "jarvis3-pick-project-p-handbook").click();
  await page.keyboard.press("Escape");
  await expect(visible(page, `jarvis3-chip-project-${website?.id}`)).toBeVisible();
  await expect(visible(page, "jarvis3-composer-projects")).toContainText("Projects (2)");
  await shoot(page, "composer-projects", async () => {
    await expect(page.getByTestId("jarvis3-new-chat-screen")).toBeVisible();
    if (!(await visible(page, "jarvis3-pick-project-p-handbook").count())) {
      await visible(page, "jarvis3-composer-projects").click();
    }
  });
  // shoot() reloads and leaves the menu open: close it, then pick again
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Menu backdrop")).toHaveCount(0);
  await visible(page, "jarvis3-composer-projects").click();
  await visible(page, `jarvis3-pick-project-${website?.id}`).click();
  await visible(page, "jarvis3-pick-project-p-handbook").click();
  await page.keyboard.press("Escape");
  const input = visible(page, "jarvis3-composer-input");
  await input.fill("Fix the footer links on the site");
  await input.press("Enter");
  // task and Project ids share the mock's counter
  await expect(page).toHaveURL(/\/chats\/new[0-9a-f]+$/);
  expect(instance.state.createRequests.at(-1)?.projects).toEqual([website?.id, "p-handbook"]);
  await expect(visible(page, "jarvis3-chat-projects")).toHaveText(
    "Projects: Website, Staff handbook",
  );

  // two Projects with different values for the same key: refused, the key named
  const clash = await page.request.post(`${instance.url}/api/projects`, {
    data: { name: "Reports v2", secrets: { API_TOKEN: "two" } },
  });
  const other = (await clash.json()) as { id: string };
  await page.goto(`${instance.url}/`);
  await visible(page, "jarvis3-composer-projects").click();
  await visible(page, "jarvis3-pick-project-p-reports").click();
  await visible(page, `jarvis3-pick-project-${other.id}`).click();
  await page.keyboard.press("Escape");
  await visible(page, "jarvis3-composer-input").fill("Compare both report feeds");
  await visible(page, "jarvis3-composer-input").press("Enter");
  await expect(visible(page, "jarvis3-new-chat-error")).toContainText("API_TOKEN");
  await expect(page).toHaveURL(new RegExp(`${instance.url}/$`));
});

test("an admin shares a Project with a role, and doesn't see people's private ones", async ({
  page,
  context,
}) => {
  await signIn(context, "admin@example.org");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${instance.url}/projects`);
  await expect(visible(page, "jarvis3-projects-screen")).toContainText("Finance exports");
  await expect(visible(page, "jarvis3-projects-screen")).not.toContainText("Website");
  await expect(visible(page, "jarvis3-projects-screen")).not.toContainText("Bob's scripts");
  await visible(page, "jarvis3-new-project").click();
  await visible(page, "jarvis3-project-name").fill("Brand assets");
  await visible(page, "jarvis3-project-shared").click();
  await visible(page, "jarvis3-project-role-staff").click();
  await page.screenshot({ path: path.join(SHOTS, "project-shared-desktop-light.png") });
  await visible(page, "jarvis3-project-save").click();
  await expect(page).toHaveURL(/\/projects\/p[0-9a-f]+$/);
  const shared = instance.state.projects.find((p) => p.name === "Brand assets");
  expect(shared).toMatchObject({ ownerId: null, roles: ["staff"] });
});
