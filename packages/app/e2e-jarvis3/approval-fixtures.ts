// Example approvals for the mock instance (approvals.spec.ts and the standalone mock): one of each
// kind the app decides differently. Alice is staff and owns the task; Admin is an admin and the
// instance's owner. All names and addresses are examples.
import type { ApprovalView } from "../src/jarvis3/api-types";

const ALICE = { id: "u-alice", email: "alice@example.org", name: "Alice" };
const ADMIN = { id: "u-admin", email: "admin@example.org", name: "Admin" };

export const APPROVAL_IDS = {
  selfConfirm: "ap-email",
  guard: "ap-guard",
  access: "ap-access",
  question: "ap-question",
  tier3: "ap-dns",
  done: "ap-done",
  denied: "ap-denied",
} as const;

function at(minutesAgo: number, base: number): string {
  return new Date(base - minutesAgo * 60_000).toISOString();
}

export function exampleApprovals(taskId: string, taskTitle: string, base = Date.now()) {
  const common = {
    taskId,
    taskTitle,
    user: ALICE,
    state: "pending" as const,
    options: null,
    changeHash: null,
    decision: null,
    result: null,
    error: null,
    canDecide: false,
    decideWith: null,
  };
  const approvals: ApprovalView[] = [
    {
      ...common,
      id: APPROVAL_IDS.selfConfirm,
      kind: "action",
      approver: "self",
      action: "company_email",
      preview: {
        summary: "Send an email to buyer@example.net from alice@example.org",
        fields: [
          { label: "From", value: "alice@example.org" },
          { label: "To", value: "buyer@example.net" },
          { label: "Cc", value: "orders@example.org" },
          { label: "Subject", value: "Q3 supplier summary" },
        ],
        body: "Hello,\n\nPlease find the Q3 supplier summary below.\n\n- 14 active suppliers\n- 2 contracts up for renewal in November\n\nBest regards,\nAlice",
      },
      reason: "You asked me to send the summary to the buyer once it was ready.",
      createdAt: at(12, base),
      updatedAt: at(12, base),
    },
    {
      ...common,
      id: APPROVAL_IDS.guard,
      kind: "guard",
      approver: "self",
      action: "delete-files",
      preview: {
        summary: "Run a command that deletes files",
        fields: [{ label: "Rule", value: "Deleting files outside the workspace" }],
        body: "rm -rf /data/exports/2026-09",
      },
      reason: "The September export folder is a duplicate of the archive.",
      createdAt: at(8, base),
      updatedAt: at(8, base),
    },
    {
      ...common,
      id: APPROVAL_IDS.access,
      kind: "access",
      approver: "admin",
      action: "company_email",
      preview: {
        summary: "Let this task use “Send email from your own mailbox”",
        fields: [
          { label: "Action", value: "company_email (smtp.send)" },
          { label: "What it does", value: "Sends an email from the task owner's mailbox" },
          { label: "Each use", value: "Alice confirms every email with one tap" },
        ],
        body: null,
      },
      reason: "The task needs to send the summary by email; the staff role doesn't have it yet.",
      createdAt: at(30, base),
      updatedAt: at(30, base),
    },
    {
      ...common,
      id: APPROVAL_IDS.question,
      kind: "question",
      approver: "admin",
      action: null,
      preview: {
        summary: "Which supplier list should the Q3 summary use?",
        fields: [],
        body: "The shared drive has two supplier lists: the June list (14 suppliers) and the September list (16 suppliers, two not yet verified).",
      },
      reason: "The two lists disagree on two suppliers.",
      options: ["The September list", "The June list", "Both, with the differences marked"],
      createdAt: at(20, base),
      updatedAt: at(20, base),
    },
    {
      ...common,
      id: APPROVAL_IDS.tier3,
      kind: "action",
      approver: "owner",
      action: "dns_record",
      preview: {
        summary: "Add the DNS record reports.example.org → 203.0.113.10",
        fields: [
          { label: "Zone", value: "example.org" },
          { label: "Type", value: "A" },
          { label: "Name", value: "reports" },
          { label: "Value", value: "203.0.113.10" },
          { label: "Proxied", value: "yes" },
        ],
        body: '{\n  "zone": "example.org",\n  "type": "A",\n  "name": "reports",\n  "content": "203.0.113.10",\n  "proxied": true\n}',
      },
      reason: "The reports site needs a hostname.",
      changeHash: "9f2c4e1a7b3d5f60c8e2a4b6d8f0e1c3a5b7d9f1e3c5a7b9d1f3e5a7c9b1d3f5",
      createdAt: at(5, base),
      updatedAt: at(5, base),
    },
    {
      ...common,
      id: APPROVAL_IDS.done,
      kind: "action",
      approver: "self",
      action: "company_email",
      state: "done",
      preview: {
        summary: "Send an email to supplier@example.net from alice@example.org",
        fields: [{ label: "Subject", value: "Delivery dates" }],
        body: "Hello,\n\nCould you confirm the delivery dates?\n\nAlice",
      },
      decision: { by: ALICE, at: at(90, base), note: null, grantScope: null, passkey: false },
      reason: "You asked me to check the delivery dates.",
      result: { messageId: "<example-1@example.org>" },
      createdAt: at(95, base),
      updatedAt: at(89, base),
    },
    {
      ...common,
      id: APPROVAL_IDS.denied,
      kind: "access",
      approver: "admin",
      action: "payments",
      state: "denied",
      preview: {
        summary: "Let this task use “Pay an invoice”",
        fields: [{ label: "Action", value: "payments (invoice.pay)" }],
        body: null,
      },
      decision: {
        by: ADMIN,
        at: at(200, base),
        note: "Invoices go through finance.",
        grantScope: null,
        passkey: false,
      },
      reason: "The supplier's invoice is due this week.",
      createdAt: at(240, base),
      updatedAt: at(200, base),
    },
  ];
  return approvals;
}
