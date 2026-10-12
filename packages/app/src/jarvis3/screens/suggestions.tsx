// "Suggest for everyone" (docs/API.md section 7a in DE0CH/jarvis3): a button on a personal skill,
// the instructions or a note opens a pull request on the company's org-env repo for an admin to
// review; the lists show each pull request's link and state.
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsRow } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/utils/open-external-url";
import type { SuggestionView } from "../api-types";
import { jarvis3Api } from "../client";
import {
  openSuggestionFor,
  presentSuggestion,
  type SuggestTarget,
  suggestionTargetLabel,
} from "../plan";
import { messageOf } from "../stores";
import { CenteredDialog, StatusPill } from "../ui";

export interface SuggestionsState {
  list: SuggestionView[] | null;
  error: string | null;
  /** The pull request just opened, for a confirmation banner. */
  opened: SuggestionView | null;
  busy: boolean;
  suggest: (target: SuggestTarget) => Promise<void>;
}

/** The caller's suggestions (or, with `all`, everyone's), loaded when `enabled`. */
export function useSuggestions(enabled: boolean, scope: { all?: boolean } = {}): SuggestionsState {
  const all = scope.all === true;
  const [list, setList] = useState<SuggestionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<SuggestionView | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const run = async () => {
      try {
        setList((await jarvis3Api.listSuggestions({ all })).suggestions);
        setError(null);
      } catch (e) {
        setError(messageOf(e));
      }
    };
    void run();
  }, [enabled, all]);

  const suggest = useCallback(async (target: SuggestTarget) => {
    setBusy(true);
    setOpened(null);
    try {
      const created = await jarvis3Api.suggest(target);
      setList((current) => [created, ...(current ?? [])]);
      setOpened(created);
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { list, error, opened, busy, suggest };
}

function openLink(url: string): void {
  void openExternalUrl(url);
}

/**
 * "Suggest for everyone" on one item, behind a confirmation. When that item already has an open
 * suggestion the button opens its pull request instead.
 */
export function SuggestButton({
  state,
  target,
  label,
}: {
  state: SuggestionsState;
  target: SuggestTarget;
  label: string;
}) {
  const [asking, setAsking] = useState(false);
  const existing = openSuggestionFor(state.list ?? [], target);
  const ask = useCallback(() => setAsking(true), []);
  const cancel = useCallback(() => setAsking(false), []);
  const confirm = useCallback(() => {
    setAsking(false);
    void state.suggest(target);
  }, [state, target]);
  const openExisting = useCallback(() => {
    if (existing) openLink(existing.url);
  }, [existing]);

  if (existing) {
    return (
      <Button variant="ghost" size="sm" onPress={openExisting}>
        Suggested
      </Button>
    );
  }
  return (
    <>
      <Button variant="ghost" size="sm" disabled={state.busy} onPress={ask}>
        Suggest for everyone
      </Button>
      <CenteredDialog
        visible={asking}
        title="Suggest for everyone?"
        message={`${label} is sent to an admin as a proposed change to the company's setup. If they accept it, every new chat loads it.`}
        confirmLabel="Suggest"
        busy={state.busy}
        onCancel={cancel}
        onConfirm={confirm}
        testID="jarvis3-suggest-dialog"
      />
    </>
  );
}

/** Pull requests with their state and link. `showOwner`: the admin's list of everyone's. */
export function SuggestionsCard({
  list,
  showOwner,
  testID,
}: {
  list: readonly SuggestionView[];
  showOwner?: boolean;
  testID?: string;
}) {
  return (
    <SettingsCard testID={testID}>
      {list.length === 0 ? <SettingsRow label="No suggestions yet" /> : null}
      {list.map((s) => (
        <SuggestionRow key={s.id} suggestion={s} showOwner={showOwner === true} />
      ))}
    </SettingsCard>
  );
}

function SuggestionRow({
  suggestion,
  showOwner,
}: {
  suggestion: SuggestionView;
  showOwner: boolean;
}) {
  const view = presentSuggestion(suggestion);
  const open = useCallback(() => openLink(suggestion.url), [suggestion.url]);
  const owner = showOwner ? ` · from ${suggestion.userEmail}` : "";
  return (
    <SettingsRow
      label={`${suggestionTargetLabel(suggestion)} · #${suggestion.number}`}
      hint={`${suggestion.title}${owner}`}
      testID={`jarvis3-suggestion-${suggestion.id}`}
    >
      <View style={styles.trailing}>
        <StatusPill tone={view.tone} label={view.label} />
        <Button variant="ghost" size="sm" onPress={open}>
          Open
        </Button>
      </View>
    </SettingsRow>
  );
}

const styles = StyleSheet.create((theme) => ({
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
}));
