// Approvals in the jarvis3 web build against the mock instance (no daemon needed): the count in
// the navigation, the task chat's inline notice, the queue, and each way to decide: a self-confirm
// (one tap), a deny with a reason, an access grant with its scope, a question's answer, and a
// Tier 3 change approved on the (mock) passkey page. Saves phone (390) and desktop (1400)
// screenshots, light, to JARVIS3_SCREENSHOT_DIR (default e2e-artifacts/jarvis3).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { TaskView } from "../src/jarvis3/api-types";
import { APPROVAL_IDS, exampleApprovals } from "./approval-fixtures";
import { startMockInstance, type MockInstance } from "./mock-instance";

const DIST = path.resolve(__dirname, "../dist-jarvis3");
const SHOTS = path.resolve(
  process.env.JARVIS3_SCREENSHOT_DIR ?? path.resolve(__dirname, "../e2e-artifacts/jarvis3"),
);

const TASK = "d4d4d4d4d4d4d4d4";
const TITLE = "Draft the Q3 supplier summary";

let instance: MockInstance;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const t = "2026-10-10T09:00:00.000Z";
  const task: TaskView = {
    id: TASK,
    userId: "u-alice",
    title: TITLE,
    model: "anthropic/claude-example",
    state: "paused",
    busy: null,
    error: null,
    pausedReason: "idle",
    createdAt: t,
    updatedAt: t,
    connected: false,
    agentId: null,
    lastActivityAt: t,
    projects: [],
  };
  instance = await startMockInstance({
    distDir: DIST,
    startDelayMs: 1_000,
    tasks: [task],
    approvals: exampleApprovals(TASK, TITLE),
    ownerId: "u-admin",
    notices: {
      "u-admin": [
        {
          id: "n-access",
          kind: "approval_needed",
          text: "Access request: Let this task use “Send email from your own mailbox”",
          taskId: TASK,
          approvalId: APPROVAL_IDS.access,
          createdAt: t,
          read: false,
        },
      ],
    },
  });
});

test.afterAll(async () => {
  await instance?.close();
});

async function signIn(context: BrowserContext, email: string): Promise<void> {
  await context.addCookies([{ name: "CF_Authorization", value: email, url: instance.url }]);
}

/** Phone and desktop, light; `ready` waits for the page's content after each size change. */
async function shoot(page: Page, name: string, ready: () => Promise<void>): Promise<void> {
  await page.emulateMedia({ colorScheme: "light" });
  for (const [label, width, height] of [
    ["phone", 390, 1100],
    ["desktop", 1400, 1000],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    await ready();
    await page.screenshot({ path: path.join(SHOTS, `approvals-${name}-${label}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  // Crossing Paseo's compact/desktop breakpoint remounts the route; carry on from a settled page.
  await page.reload();
  await ready();
}

test("staff: the count, the chat notice, the queue, approve and deny their own", async ({
  page,
  context,
}) => {
  await signIn(context, "alice@example.org");
  await page.goto(`${instance.url}/chats/${TASK}`);
  await expect(page.getByTestId("jarvis3-nav-approvals-count")).toHaveText("2");
  const notice = page.getByTestId("jarvis3-chat-approval");
  await expect(notice).toContainText("Waiting on you: 2 requests from this chat.");
  await shoot(page, "chat-notice", () => expect(notice).toBeVisible());

  await page.getByTestId("jarvis3-chat-approval-review").click();
  await expect(page).toHaveURL(/\/approvals$/);
  const pending = page.getByTestId("jarvis3-approvals-pending");
  await expect(pending).toContainText("Send an email to buyer@example.net");
  await expect(pending).toContainText("Run a command that deletes files");
  await expect(page.getByTestId("jarvis3-approvals-recent")).toContainText(
    "Let this task use “Pay an invoice”",
  );
  await expect(page.getByTestId("jarvis3-passkeys")).toHaveCount(0);
  await shoot(page, "queue-staff", () => expect(pending).toBeVisible());

  // Self-confirm: the exact email, one tap.
  await page.getByTestId(`jarvis3-approval-open-${APPROVAL_IDS.selfConfirm}`).click();
  await expect(page).toHaveURL(new RegExp(`/approvals/${APPROVAL_IDS.selfConfirm}$`));
  const body = page.getByTestId("jarvis3-approval-body");
  await expect(body).toContainText("- 2 contracts up for renewal in November");
  await expect(page.getByTestId("jarvis3-approval-preview")).toContainText("orders@example.org");
  await shoot(page, "self-confirm", () => expect(body).toBeVisible());
  await page.getByTestId("jarvis3-approval-approve").click();
  await expect(page.getByTestId("jarvis3-approval-state")).toContainText(/Running|Done/);
  await expect(page.getByTestId("jarvis3-approval-state")).toContainText("Done", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("jarvis3-approval-outcome")).toContainText("Approved by Alice");
  await expect(page.getByTestId("jarvis3-approval-decide")).toHaveCount(0);

  // Deny a command, with a reason.
  await page.goto(`${instance.url}/approvals/${APPROVAL_IDS.guard}`);
  await expect(page.getByTestId("jarvis3-approval-body")).toContainText("rm -rf /data/exports");
  await page.getByTestId("jarvis3-approval-deny").click();
  await page.getByTestId("jarvis3-approval-deny-note").fill("Keep the folder until Friday.");
  await page.getByTestId("jarvis3-approval-deny-confirm").click();
  await expect(page.getByTestId("jarvis3-approval-state")).toContainText("Denied");
  await expect(page.getByTestId("jarvis3-approval-outcome")).toContainText(
    "Keep the folder until Friday.",
  );
  await expect(page.getByTestId("jarvis3-nav-approvals-count")).toHaveCount(0);
  expect(instance.state.approvals.find((a) => a.id === APPROVAL_IDS.guard)?.decision?.note).toBe(
    "Keep the folder until Friday.",
  );
});

test("admin and owner: access grant, a question's answer, a Tier 3 change", async ({
  page,
  context,
}) => {
  await signIn(context, "admin@example.org");
  // The approval_needed notice opens that approval, not the queue.
  await page.goto(`${instance.url}/notices`);
  await page.getByTestId("jarvis3-notice-n-access").getByRole("button", { name: "Review" }).click();
  await expect(page).toHaveURL(new RegExp(`/approvals/${APPROVAL_IDS.access}$`));
  await expect(page.getByTestId("jarvis3-approval-scope-role")).toContainText(
    "Everyone with the role “staff”",
  );

  await page.goto(`${instance.url}/approvals`);
  await expect(page.getByTestId("jarvis3-nav-approvals-count")).toHaveText("3");
  const pending = page.getByTestId("jarvis3-approvals-pending");
  await expect(pending).toContainText("Add the DNS record reports.example.org");
  await expect(page.getByTestId("jarvis3-passkeys")).toBeVisible();
  await shoot(page, "queue-admin", () => expect(pending).toBeVisible());

  // Access request: who gets it.
  await page.getByTestId(`jarvis3-approval-open-${APPROVAL_IDS.access}`).click();
  const scope = page.getByTestId("jarvis3-approval-scope-role");
  // The role comes with the approval (ApprovalView.userRole), not from the admin-only user list.
  await expect(scope).toContainText("Everyone with the role “staff”");
  expect(instance.state.requests).not.toContain("GET /api/users");
  await shoot(page, "access", () => expect(scope).toBeVisible());
  await page.getByTestId("jarvis3-approval-scope-role").click();
  await page.getByTestId("jarvis3-approval-approve").click();
  await expect(page.getByTestId("jarvis3-approval-state")).toContainText("Granted");
  await expect(page.getByTestId("jarvis3-approval-outcome")).toContainText(
    "Everyone with the same role",
  );
  expect(
    instance.state.approvals.find((a) => a.id === APPROVAL_IDS.access)?.decision?.grantScope,
  ).toBe("role");

  // A question: a quick pick fills the answer, Send answers.
  await page.goto(`${instance.url}/approvals/${APPROVAL_IDS.question}`);
  const option = page.getByTestId("jarvis3-approval-option-0");
  await expect(option).toContainText("The September list");
  await shoot(page, "question", () => expect(option).toBeVisible());
  await expect(page.getByTestId("jarvis3-approval-approve")).toBeDisabled();
  await option.click();
  await expect(page.getByTestId("jarvis3-approval-answer")).toHaveValue("The September list");
  await page.getByTestId("jarvis3-approval-approve").click();
  await expect(page.getByTestId("jarvis3-approval-state")).toContainText("Answered");
  await expect(page.getByTestId("jarvis3-approval-outcome")).toContainText("The September list");

  // Tier 3: the passkey page approves, and comes back to the approval.
  await page.goto(`${instance.url}/approvals/${APPROVAL_IDS.tier3}`);
  const faceId = page.getByTestId("jarvis3-approval-passkey");
  await expect(faceId).toContainText("Approve with Face ID");
  await expect(page.getByTestId("jarvis3-approval-preview")).toContainText("203.0.113.10");
  await shoot(page, "tier3", () => expect(faceId).toBeVisible());
  await faceId.click();
  await expect(page).toHaveURL(
    new RegExp(
      `/api/pages/approvals/${APPROVAL_IDS.tier3}\\?return=%2Fapprovals%2F${APPROVAL_IDS.tier3}$`,
    ),
  );
  await page.locator("#mock-passkey-approve").click();
  await expect(page).toHaveURL(new RegExp(`/approvals/${APPROVAL_IDS.tier3}$`));
  await expect(page.getByTestId("jarvis3-approval-state")).toContainText(/Running|Done/);
  await expect(page.getByTestId("jarvis3-approval-outcome")).toContainText("with a passkey");
  await expect(page.getByTestId("jarvis3-nav-approvals-count")).toHaveCount(0);
});
