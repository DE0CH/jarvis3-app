// The approvals queue: what waits for the caller's decision first (oldest first), then recent
// approvals. Admins see everyone's, staff their own. The instance's owner also gets the entry to
// add a passkey, which Tier 3 approvals need.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, type Href } from "expo-router";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import type { ApprovalView } from "../api-types";
import { approvalKindLabel, approvalStateLabel, askedBy, splitQueue } from "../approvals";
import { accountStore, approvalsStore } from "../client";
import { useAccount, useApprovals } from "../hooks";
import { openPasskeysPage } from "../server-page";
import { messageOf } from "../stores";
import { Banner, EmptyState, Jarvis3Frame, StatusPill } from "../ui";
import { formatWhen } from "./format";

export function ApprovalsScreen() {
  const approvals = useApprovals();
  const account = useAccount();
  const { pending, recent } = useMemo(() => splitQueue(approvals.approvals), [approvals.approvals]);

  useEffect(() => {
    void approvalsStore.loadQueue();
    void accountStore.refreshMe();
  }, []);

  return (
    <Jarvis3Frame title="Approvals" testID="jarvis3-approvals">
      {approvals.error ? <Banner tone="error">{approvals.error}</Banner> : null}
      {approvals.loaded ? (
        <>
          <SettingsSection title="Waiting for you" testID="jarvis3-approvals-pending">
            {pending.length > 0 ? (
              <ApprovalCard approvals={pending} />
            ) : (
              <EmptyState
                title="Nothing waits for you"
                hint="When an agent asks to do something that needs your yes, it shows here."
              />
            )}
          </SettingsSection>
          {recent.length > 0 ? (
            <SettingsSection title="Recent" testID="jarvis3-approvals-recent">
              <ApprovalCard approvals={recent} />
            </SettingsSection>
          ) : null}
        </>
      ) : (
        <EmptyState title="Loading…" />
      )}
      {account.me?.isOwner ? <PasskeysEntry /> : null}
    </Jarvis3Frame>
  );
}

function ApprovalCard({ approvals }: { approvals: ApprovalView[] }) {
  return (
    <SettingsCard>
      {approvals.map((approval) => (
        <ApprovalRow key={approval.id} approval={approval} />
      ))}
    </SettingsCard>
  );
}

function ApprovalRow({ approval }: { approval: ApprovalView }) {
  const router = useRouter();
  const open = useCallback(
    () => router.push(`/approvals/${encodeURIComponent(approval.id)}` as Href),
    [router, approval.id],
  );
  const state = approvalStateLabel(approval);
  const decidable = approval.state === "pending" && approval.canDecide;
  const hint = [
    approvalKindLabel(approval),
    askedBy(approval),
    approval.taskTitle,
    formatWhen(approval.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");
  const pill = useMemo(
    () => <StatusPill tone={state.tone} label={state.label} />,
    [state.tone, state.label],
  );
  return (
    <SettingsRow
      label={approval.preview.summary}
      hint={hint}
      labelAccessory={pill}
      testID={`jarvis3-approval-${approval.id}`}
    >
      <Button
        variant={decidable ? "default" : "ghost"}
        size="sm"
        onPress={open}
        testID={`jarvis3-approval-open-${approval.id}`}
      >
        {decidable ? "Review" : "Open"}
      </Button>
    </SettingsRow>
  );
}

/** The owner's passkey setup (the instance's page; WebAuthn needs its origin). */
function PasskeysEntry() {
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(() => {
    setError(null);
    openPasskeysPage().catch((e: unknown) => setError(messageOf(e)));
  }, []);
  return (
    <SettingsSection title="Passkeys" testID="jarvis3-passkeys">
      <SettingsCard>
        <SettingsRow
          label="Passkeys for infrastructure changes"
          hint="You approve infrastructure changes with Face ID. Add a passkey on each device you approve from."
          error={error}
        >
          <Button variant="outline" size="sm" onPress={open} testID="jarvis3-passkeys-open">
            Manage passkeys
          </Button>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
