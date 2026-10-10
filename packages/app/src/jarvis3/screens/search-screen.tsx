// Search: the user's own tasks' conversations (docs/API.md in DE0CH/jarvis3, "Transcript
// search"), archived and paused tasks included. A hit opens the transcript around it. Admins can
// search everyone's tasks.
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsInput } from "@/components/settings";
import { Button } from "@/components/ui/button";
import type { SearchHit, SearchResult } from "../api-types";
import { jarvis3Api } from "../client";
import { useAccount } from "../hooks";
import { stateLabel } from "../plan";
import {
  groupHits,
  highlightSegments,
  normaliseQuery,
  roleLabel,
  transcriptHref,
  type HitGroup,
} from "../search";
import { messageOf } from "../stores";
import { Banner, EmptyState, Jarvis3Frame } from "../ui";
import { formatWhen } from "./format";

export function SearchScreen() {
  const account = useAccount();
  const isAdmin = account.me?.user.isAdmin === true;
  const [text, setText] = useState("");
  const [everyone, setEveryone] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (all: boolean) => {
      const q = normaliseQuery(text);
      if (!q) return;
      const go = async () => {
        setSearching(true);
        setError(null);
        try {
          setResult(await jarvis3Api.search({ q, all: all || undefined }));
        } catch (e) {
          setError(messageOf(e));
        } finally {
          setSearching(false);
        }
      };
      void go();
    },
    [text],
  );
  const submit = useCallback(() => run(everyone), [run, everyone]);
  const toggleEveryone = useCallback(() => {
    const next = !everyone;
    setEveryone(next);
    if (result) run(next);
  }, [everyone, result, run]);

  return (
    <Jarvis3Frame title="Search" testID="jarvis3-search-screen">
      <SettingsCard>
        <SettingsInput
          label="Search your tasks"
          hint="Finds words in what you and the agents wrote, in every task, archived ones too."
          initialValue=""
          onChangeText={setText}
          placeholder="supplier invoice"
        />
        <View style={styles.controls}>
          {isAdmin ? (
            <Button
              variant={everyone ? "secondary" : "ghost"}
              size="sm"
              onPress={toggleEveryone}
              testID="jarvis3-search-everyone"
            >
              {everyone ? "Everyone's tasks" : "Only mine"}
            </Button>
          ) : null}
          <Button
            variant="default"
            size="sm"
            onPress={submit}
            loading={searching}
            disabled={!normaliseQuery(text)}
            testID="jarvis3-search-submit"
          >
            Search
          </Button>
        </View>
      </SettingsCard>
      {error ? (
        <Banner tone="error" testID="jarvis3-search-error">
          {error}
        </Banner>
      ) : null}
      <Results result={result} everyone={everyone} />
    </Jarvis3Frame>
  );
}

function Results({ result, everyone }: { result: SearchResult | null; everyone: boolean }) {
  if (!result) return null;
  if (result.hits.length === 0) {
    return <EmptyState title="Nothing found" hint={`No messages match “${result.query}”.`} />;
  }
  return (
    <View style={styles.groups} testID="jarvis3-search-results">
      {groupHits(result.hits).map((group) => (
        <Group key={group.taskId} group={group} everyone={everyone} />
      ))}
    </View>
  );
}

function Group({ group, everyone }: { group: HitGroup; everyone: boolean }) {
  const state = stateLabel(group.taskState);
  return (
    <SettingsCard testID={`jarvis3-search-group-${group.taskId}`}>
      <View style={styles.groupHead}>
        <Text style={styles.taskTitle} numberOfLines={2}>
          {group.taskTitle}
        </Text>
        <Text style={styles.hint}>{everyone ? `${state} · ${group.userId}` : state}</Text>
      </View>
      {group.hits.map((hit) => (
        <HitRow key={`${hit.agentId}:${hit.seq}`} hit={hit} />
      ))}
    </SettingsCard>
  );
}

function HitRow({ hit }: { hit: SearchHit }) {
  const router = useRouter();
  const open = useCallback(() => router.push(transcriptHref(hit) as Href), [router, hit]);
  return (
    <Pressable
      style={styles.hit}
      onPress={open}
      accessibilityRole="link"
      testID={`jarvis3-search-hit-${hit.taskId}-${hit.seq}`}
    >
      <Text style={styles.hint}>{`${roleLabel(hit.role)} · ${formatWhen(hit.at)}`}</Text>
      <Snippet snippet={hit.snippet} matches={hit.matches} />
    </Pressable>
  );
}

export function Snippet({ snippet, matches }: { snippet: string; matches: [number, number][] }) {
  return (
    <Text style={styles.snippet} numberOfLines={4}>
      {highlightSegments(snippet, matches).map((segment, i) =>
        segment.match ? (
          // oxlint-disable-next-line react/no-array-index-key -- segments have no identity
          <Text key={i} style={styles.match}>
            {segment.text}
          </Text>
        ) : (
          segment.text
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  controls: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
  },
  groups: {
    gap: theme.spacing[3],
  },
  groupHead: {
    gap: theme.spacing[1],
    paddingTop: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  taskTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  hit: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  snippet: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  match: {
    fontWeight: theme.fontWeight.semibold,
    backgroundColor: theme.colors.surface3,
  },
}));
