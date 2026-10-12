// "Usage this month" (from the profile menu): the person's own allowance and use this month —
// model spend, machine time, and, when the instance has Tier 0 tools, web search/fetch spend and
// proxy traffic against their caps (GET /api/me, refreshed with the account).
import { SettingsCard, SettingsRow, SettingsSection } from "@/components/settings";
import { useAccount } from "../hooks";
import { myUsageRows } from "../plan";
import { EmptyState, Jarvis3Frame, StatusPill } from "../ui";

export function UsageScreen() {
  const me = useAccount().me;
  return (
    <Jarvis3Frame title="Usage this month" testID="jarvis3-usage-screen">
      {me ? (
        <SettingsSection title={`This month (${me.usage.month})`}>
          <SettingsCard testID="jarvis3-my-usage">
            {myUsageRows(me).map((row) => (
              <SettingsRow
                key={row.key}
                label={row.label}
                hint={row.value}
                testID={`jarvis3-my-usage-${row.key}`}
              >
                {row.capReached ? <StatusPill tone="error" label="At cap" /> : null}
              </SettingsRow>
            ))}
          </SettingsCard>
        </SettingsSection>
      ) : (
        <EmptyState title="Loading…" />
      )}
    </Jarvis3Frame>
  );
}
