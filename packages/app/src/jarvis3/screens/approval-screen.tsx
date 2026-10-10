// One approval: exactly what will happen (the server's preview, shown verbatim), who asked, for
// which task and why, and the decision controls the caller has. Decisions are two-phase: the
// page changes when the server has answered, never before.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import type { ApprovalView } from "../api-types";
import {
  approvalKindLabel,
  approvalStateLabel,
  approverLabel,
  askedBy,
  decisionVerb,
  type DecideInput,
  isDecidableNow,
} from "../approvals";
import { approvalsStore } from "../client";
import { useApprovals } from "../hooks";
import { openApprovalPage } from "../server-page";
import { messageOf, REFRESH_WHILE_CHANGING_MS } from "../stores";
import { Banner, EmptyState, Jarvis3Frame, StatusPill } from "../ui";
import { formatWhen } from "./format";

/** While someone else may still decide, look again now and then. */
const REFRESH_PENDING_MS = 15_000;

export function ApprovalScreen({ approvalId }: { approvalId: string }) {
  const approvals = useApprovals();
  const approval = approvals.byId[approvalId] ?? null;
  const loadError = approvals.loadErrors[approvalId] ?? null;

  useEffect(() => {
    void approvalsStore.load(approvalId);
  }, [approvalId]);

  // An approved action runs on the server: follow it to done or failed.
  const state = approval?.state;
  useEffect(() => {
    if (!state || !["pending", "approved", "executing"].includes(state)) return;
    const ms = state === "pending" ? REFRESH_PENDING_MS : REFRESH_WHILE_CHANGING_MS;
    const timer = setInterval(() => void approvalsStore.load(approvalId), ms);
    return () => clearInterval(timer);
  }, [state, approvalId]);

  const title = approval ? approvalKindLabel(approval) : "Approval";
  const pill = approval ? approvalStateLabel(approval) : null;
  const actions = useMemo(
    () =>
      pill ? (
        <StatusPill tone={pill.tone} label={pill.label} testID="jarvis3-approval-state" />
      ) : null,
    [pill],
  );

  return (
    <Jarvis3Frame title={title} actions={actions} testID="jarvis3-approval">
      {loadError ? <Banner tone="error">{loadError}</Banner> : null}
      {approval ? <ApprovalBody approval={approval} /> : null}
      {!approval && !loadError ? <EmptyState title="Loading…" /> : null}
    </Jarvis3Frame>
  );
}

function ApprovalBody({ approval }: { approval: ApprovalView }) {
  const approvals = useApprovals();
  const deciding = approvals.deciding[approval.id] === true;
  const decideError = approvals.decideErrors[approval.id] ?? null;
  return (
    <>
      <Preview approval={approval} />
      <About approval={approval} />
      {approval.decision || approval.result || approval.error ? (
        <Outcome approval={approval} />
      ) : null}
      {decideError ? (
        <Banner tone="error" testID="jarvis3-approval-error">
          {decideError}
        </Banner>
      ) : null}
      {isDecidableNow(approval) ? <DecideControls approval={approval} deciding={deciding} /> : null}
      {approval.state === "pending" && !approval.canDecide ? (
        <Banner tone="info" testID="jarvis3-approval-waiting">
          {`Waiting for ${approverLabel(approval.approver).toLowerCase()}.`}
        </Banner>
      ) : null}
    </>
  );
}

function Preview({ approval }: { approval: ApprovalView }) {
  const { preview } = approval;
  return (
    <SettingsSection title="What will happen" testID="jarvis3-approval-preview">
      <View style={styles.previewCard}>
        <Text style={styles.summary} selectable testID="jarvis3-approval-summary">
          {preview.summary}
        </Text>
        {preview.fields.map((field) => (
          <View key={`${field.label}\u0000${field.value}`} style={styles.field}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            <Text style={styles.fieldValue} selectable>
              {field.value}
            </Text>
          </View>
        ))}
        {preview.body !== null ? (
          <View style={styles.body} testID="jarvis3-approval-body">
            <Text dataSet={CODE_SURFACE_DATASET} style={styles.bodyText} selectable>
              {preview.body}
            </Text>
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}

function About({ approval }: { approval: ApprovalView }) {
  const router = useRouter();
  const taskId = approval.taskId;
  const openTask = useCallback(() => {
    if (taskId) router.push(`/tasks/${encodeURIComponent(taskId)}` as Href);
  }, [router, taskId]);
  return (
    <SettingsSection title="Request">
      <SettingsCard>
        <SettingsRow label="Asked for" hint={askedBy(approval)} />
        {taskId ? (
          <SettingsRow label="Task" hint={approval.taskTitle ?? taskId}>
            <Button variant="ghost" size="sm" onPress={openTask} testID="jarvis3-approval-task">
              Open task
            </Button>
          </SettingsRow>
        ) : null}
        {approval.reason ? <SettingsRow label="Why" hint={approval.reason} /> : null}
        <SettingsRow label="Decided by" hint={approverLabel(approval.approver)} />
        <SettingsRow label="Asked" hint={formatWhen(approval.createdAt)} />
        {approval.changeHash ? (
          <SettingsRow label="Change fingerprint" hint={approval.changeHash} />
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

function decisionText(approval: ApprovalView): string {
  const decision = approval.decision;
  if (!decision) return "";
  const who = decision.by ? decision.by.name || decision.by.email : "the instance's policy";
  const how = decision.passkey ? " with a passkey" : "";
  return `${decisionVerb(approval)} by ${who}${how}, ${formatWhen(decision.at)}`;
}

const SCOPE_TEXT = { task: "This task only", role: "Everyone with the same role" } as const;

function Outcome({ approval }: { approval: ApprovalView }) {
  const decision = approval.decision;
  return (
    <SettingsSection title="Outcome" testID="jarvis3-approval-outcome">
      <SettingsCard>
        {decision ? <SettingsRow label="Decision" hint={decisionText(approval)} /> : null}
        {decision?.note ? (
          <SettingsRow
            label={approval.kind === "question" ? "Answer" : "Note"}
            hint={decision.note}
          />
        ) : null}
        {decision?.grantScope ? (
          <SettingsRow label="Granted to" hint={SCOPE_TEXT[decision.grantScope]} />
        ) : null}
      </SettingsCard>
      {approval.error ? <Banner tone="error">{approval.error}</Banner> : null}
      {approval.result ? (
        <View style={styles.body} testID="jarvis3-approval-result">
          <Text dataSet={CODE_SURFACE_DATASET} style={styles.bodyText} selectable>
            {JSON.stringify(approval.result, null, 2)}
          </Text>
        </View>
      ) : null}
    </SettingsSection>
  );
}

function DecideControls({ approval, deciding }: { approval: ApprovalView; deciding: boolean }) {
  const [denying, setDenying] = useState(false);
  const [denyNote, setDenyNote] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerKey, setAnswerKey] = useState(0);
  const [scope, setScope] = useState<"task" | "role">("task");
  const [pageError, setPageError] = useState<string | null>(null);
  const role = approval.userRole ?? null;

  const send = useCallback(
    (input: DecideInput) => void approvalsStore.decide(approval, input),
    [approval],
  );
  const approve = useCallback(() => {
    if (approval.kind === "question") send({ decision: "approve", note: answer });
    else if (approval.kind === "access") send({ decision: "approve", grantScope: scope });
    else send({ decision: "approve" });
  }, [approval.kind, send, answer, scope]);
  const startDeny = useCallback(() => {
    approvalsStore.clearDecideError(approval.id);
    setDenying(true);
  }, [approval.id]);
  const cancelDeny = useCallback(() => setDenying(false), []);
  const deny = useCallback(() => send({ decision: "deny", note: denyNote }), [send, denyNote]);
  const pick = useCallback((option: string) => {
    setAnswer(option);
    setAnswerKey((key) => key + 1);
  }, []);
  const approveWithPasskey = useCallback(() => {
    setPageError(null);
    openApprovalPage(approval.id)
      .then(() => approvalsStore.load(approval.id))
      .catch((error: unknown) => setPageError(messageOf(error)));
  }, [approval.id]);

  const scopeOptions = useMemo(
    () => [
      { value: "task" as const, label: SCOPE_TEXT.task, testID: "jarvis3-approval-scope-task" },
      {
        value: "role" as const,
        label: role ? `Everyone with the role “${role}”` : SCOPE_TEXT.role,
        testID: "jarvis3-approval-scope-role",
      },
    ],
    [role],
  );

  if (denying) {
    return (
      <SettingsSection title="Deny" testID="jarvis3-approval-deny-form">
        <SettingsTextAreaCard
          accessibilityLabel="Why (optional)"
          value=""
          onChangeText={setDenyNote}
          placeholder="Why not, for the agent (optional)"
          testID="jarvis3-approval-deny-note"
          style={styles.note}
        />
        <View style={styles.buttons}>
          <Button variant="ghost" onPress={cancelDeny} disabled={deciding}>
            Back
          </Button>
          <Button
            variant="destructive"
            onPress={deny}
            loading={deciding}
            testID="jarvis3-approval-deny-confirm"
          >
            Deny
          </Button>
        </View>
      </SettingsSection>
    );
  }

  const denyButton = (
    <Button variant="ghost" onPress={startDeny} disabled={deciding} testID="jarvis3-approval-deny">
      Deny
    </Button>
  );

  if (approval.decideWith === "passkey") {
    return (
      <SettingsSection title="Your decision" testID="jarvis3-approval-decide">
        <Banner tone="info">
          {
            "An infrastructure change is approved with your passkey. The instance's page shows the same change again and asks for Face ID."
          }
        </Banner>
        {pageError ? <Banner tone="error">{pageError}</Banner> : null}
        <View style={styles.buttons}>
          {denyButton}
          <Button
            variant="default"
            onPress={approveWithPasskey}
            disabled={deciding}
            testID="jarvis3-approval-passkey"
          >
            Approve with Face ID
          </Button>
        </View>
      </SettingsSection>
    );
  }

  if (approval.kind === "question") {
    return (
      <SettingsSection title="Your answer" testID="jarvis3-approval-decide">
        {approval.options && approval.options.length > 0 ? (
          <View style={styles.options}>
            {approval.options.map((option, index) => (
              <OptionButton key={option} option={option} index={index} onPick={pick} />
            ))}
          </View>
        ) : null}
        <SettingsTextAreaCard
          key={answerKey}
          accessibilityLabel="Answer"
          value={answer}
          onChangeText={setAnswer}
          placeholder="Your answer"
          testID="jarvis3-approval-answer"
          style={styles.note}
        />
        <View style={styles.buttons}>
          {denyButton}
          <Button
            variant="default"
            onPress={approve}
            loading={deciding}
            disabled={!answer.trim()}
            testID="jarvis3-approval-approve"
          >
            Send answer
          </Button>
        </View>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Your decision" testID="jarvis3-approval-decide">
      {approval.kind === "access" ? (
        <View style={styles.scope}>
          <Text style={styles.fieldLabel}>Who gets this access</Text>
          <SegmentedControl
            options={scopeOptions}
            value={scope}
            onValueChange={setScope}
            testID="jarvis3-approval-scope"
          />
        </View>
      ) : null}
      <View style={styles.buttons}>
        {denyButton}
        <Button
          variant="default"
          onPress={approve}
          loading={deciding}
          testID="jarvis3-approval-approve"
        >
          {approval.kind === "access" ? "Grant access" : "Approve"}
        </Button>
      </View>
    </SettingsSection>
  );
}

function OptionButton({
  option,
  index,
  onPick,
}: {
  option: string;
  index: number;
  onPick: (option: string) => void;
}) {
  const press = useCallback(() => onPick(option), [onPick, option]);
  return (
    <Button variant="outline" size="sm" onPress={press} testID={`jarvis3-approval-option-${index}`}>
      {option}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  previewCard: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  summary: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  field: {
    gap: theme.spacing[1],
  },
  fieldLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  fieldValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  body: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  bodyText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  note: {
    minHeight: 96,
  },
  options: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  scope: {
    gap: theme.spacing[2],
  },
  buttons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
