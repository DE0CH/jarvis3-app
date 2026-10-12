// A task's conversation as the instance indexed it (GET /api/tasks/:id/transcript), opened from a
// search hit: the messages around the hit, with older and newer pages. Works for archived and
// paused tasks, whose chat can't be opened; a live or paused task links to its chat.
import { type Ref, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, type ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { isWeb } from "@/constants/platform";
import type { TaskView, TranscriptEntry, TranscriptPage } from "../api-types";
import { jarvis3Api } from "../client";
import { stateLabel } from "../plan";
import { canOpenChat, mergePage, roleLabel } from "../search";
import { messageOf } from "../stores";
import { Banner, EmptyState, Jarvis3Frame } from "../ui";
import { formatWhen } from "./format";

const PAGE = 50;

export function TranscriptScreen({
  taskId,
  around,
  agentId,
}: {
  taskId: string;
  around: number | null;
  agentId: string | null;
}) {
  const router = useRouter();
  const [task, setTask] = useState<TaskView | null>(null);
  const [page, setPage] = useState<TranscriptPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"older" | "newer" | null>(null);
  const agent = agentId ?? undefined;
  // Scroll to the hit once, when the card and the hit's row have been laid out. Native: offsets
  // are relative to their parents (the card's within the page column, the row's within the
  // card). Web: the browser finds the scrolling ancestor itself.
  const scrollRef = useRef<ScrollView>(null);
  const hitRef = useRef<View>(null);
  const cardY = useRef<number | null>(null);
  const hitY = useRef<number | null>(null);
  const scrolled = useRef(false);
  const scrollToHit = useCallback(() => {
    if (isWeb || scrolled.current || cardY.current === null || hitY.current === null) return;
    scrolled.current = true;
    scrollRef.current?.scrollTo({
      y: Math.max(0, cardY.current + hitY.current - 24),
      animated: false,
    });
  }, []);
  // Web: no layout offsets needed; scroll once the first page with the hit is in the DOM.
  useEffect(() => {
    if (!isWeb || !page || scrolled.current) return;
    const frame = requestAnimationFrame(() => {
      const element = hitRef.current as unknown as HTMLElement | null;
      if (!element || scrolled.current) return;
      scrolled.current = true;
      element.scrollIntoView?.({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [page]);
  const onCardLayout = useCallback(
    (event: LayoutChangeEvent) => {
      cardY.current = event.nativeEvent.layout.y;
      scrollToHit();
    },
    [scrollToHit],
  );
  const onHitLayout = useCallback(
    (event: LayoutChangeEvent) => {
      hitY.current = event.nativeEvent.layout.y;
      scrollToHit();
    },
    [scrollToHit],
  );

  useEffect(() => {
    const run = async () => {
      try {
        const [view, first] = await Promise.all([
          jarvis3Api.getTask(taskId),
          jarvis3Api.transcript(taskId, {
            agentId: agent,
            around: around ?? undefined,
            limit: PAGE,
          }),
        ]);
        setTask(view);
        setPage(first);
      } catch (e) {
        setError(messageOf(e));
      }
    };
    void run();
  }, [taskId, agent, around]);

  const more = useCallback(
    (direction: "older" | "newer") => {
      if (!page) return;
      const edge = direction === "older" ? page.entries[0] : page.entries.at(-1);
      if (!edge) return;
      const run = async () => {
        setLoading(direction);
        try {
          const next = await jarvis3Api.transcript(taskId, {
            agentId: agent,
            limit: PAGE,
            ...(direction === "older" ? { before: edge.seq } : { after: edge.seq }),
          });
          setPage((prev) => (prev ? mergePage(prev, next, direction) : next));
        } catch (e) {
          setError(messageOf(e));
        } finally {
          setLoading(null);
        }
      };
      void run();
    },
    [page, taskId, agent],
  );
  const older = useCallback(() => more("older"), [more]);
  const newer = useCallback(() => more("newer"), [more]);
  const openChat = useCallback(
    () => router.push(`/chats/${encodeURIComponent(taskId)}` as Href),
    [router, taskId],
  );

  const chatOpenable = task !== null && canOpenChat(task.state);
  const actions = useMemo(
    () =>
      chatOpenable ? (
        <Button
          variant="outline"
          size="sm"
          onPress={openChat}
          testID="jarvis3-transcript-open-chat"
        >
          Open chat
        </Button>
      ) : null,
    [chatOpenable, openChat],
  );

  return (
    <Jarvis3Frame
      title={task?.title ?? "Conversation"}
      actions={actions}
      scrollRef={scrollRef}
      testID="jarvis3-transcript-screen"
    >
      {task ? <Text style={styles.hint}>{stateLabel(task.state)}</Text> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {!page && !error ? <EmptyState title="Loading…" /> : null}
      {page && page.entries.length === 0 ? (
        <EmptyState
          title="Nothing indexed yet"
          hint="This chat's conversation hasn't been indexed."
        />
      ) : null}
      {page?.hasOlder ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={older}
          loading={loading === "older"}
          testID="jarvis3-transcript-older"
        >
          Earlier messages
        </Button>
      ) : null}
      {page && page.entries.length > 0 ? (
        <View onLayout={onCardLayout}>
          <SettingsCard testID="jarvis3-transcript">
            {page.entries.map((entry) => (
              <Entry
                key={`${entry.agentId}:${entry.seq}`}
                entry={entry}
                focused={entry.seq === around}
                onLayout={entry.seq === around ? onHitLayout : undefined}
                viewRef={entry.seq === around ? hitRef : undefined}
              />
            ))}
          </SettingsCard>
        </View>
      ) : null}
      {page?.hasNewer ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={newer}
          loading={loading === "newer"}
          testID="jarvis3-transcript-newer"
        >
          Later messages
        </Button>
      ) : null}
    </Jarvis3Frame>
  );
}

function Entry({
  entry,
  focused,
  onLayout,
  viewRef,
}: {
  entry: TranscriptEntry;
  focused: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  viewRef?: Ref<View>;
}) {
  return (
    <View
      ref={viewRef}
      onLayout={onLayout}
      style={[styles.entry, focused && styles.focused]}
      testID={focused ? "jarvis3-transcript-focused" : `jarvis3-transcript-entry-${entry.seq}`}
    >
      <Text style={styles.hint}>{`${roleLabel(entry.role)} · ${formatWhen(entry.at)}`}</Text>
      <Text style={entry.role === "tool" ? styles.tool : styles.text} selectable>
        {entry.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  entry: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  focused: {
    backgroundColor: theme.colors.surface2,
  },
  text: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  tool: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.code,
    fontFamily: theme.fontFamily.mono,
    lineHeight: 18,
  },
}));
