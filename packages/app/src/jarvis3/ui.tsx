// Small building blocks for the Jarvis 3 screens, made of Paseo's own components and theme:
// the page frame (a header with the sidebar's menu button, or a back button on a detail screen),
// a centered question dialog (never alert()/confirm(), never a bottom sheet), an inline banner and
// a status pill. The sidebar itself is in sidebar.tsx.
import { Children, type ReactNode, type Ref, useCallback } from "react";
import { Modal, Pressable, type ScrollView as NativeScrollView, Text, View } from "react-native";
import { usePathname, useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView } from "@/components/ui/scroll-view";
import { Button } from "@/components/ui/button";
import { BackHeader } from "@/components/headers/back-header";
import { MenuHeader } from "@/components/headers/menu-header";
import { type Tone } from "./plan";
import { NEW_CHAT_HREF, routeKind } from "./nav";

/** Where Back goes when there is no screen to go back to (a detail screen opened by a link). */
function parentOf(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "me" && parts[1] === "notifications") return "/notices";
  if (parts[0] === "channels" && parts[1]) return `/chats/${parts[1]}`;
  if (parts.length > 1) return `/${parts[0]}`;
  return NEW_CHAT_HREF;
}

export function Jarvis3Frame({
  title,
  actions,
  children,
  scroll = true,
  scrollRef,
  testID,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  /** The page's scroll view, for a screen that scrolls to something (the transcript's hit). */
  scrollRef?: Ref<NativeScrollView>;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(parentOf(pathname) as Href);
  }, [router, pathname]);
  const header =
    routeKind(pathname) === "detail" ? (
      <BackHeader title={title} rightContent={actions} onBack={back} />
    ) : (
      <MenuHeader title={title} rightContent={actions} />
    );
  const body = <View style={styles.column}>{children}</View>;
  return (
    <View style={styles.page} testID={testID}>
      {header}
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        >
          {body}
        </ScrollView>
      ) : (
        <View style={styles.fill}>{body}</View>
      )}
    </View>
  );
}

function bannerToneStyle(tone: "info" | "error" | "ok") {
  if (tone === "error") return styles.bannerError;
  if (tone === "ok") return styles.bannerOk;
  return null;
}

/** An inline notice. Text children are the message; any other child (a button) is its action. */
export function Banner({
  tone,
  children,
  testID,
}: {
  tone: "info" | "error" | "ok";
  children: ReactNode;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      accessibilityRole={tone === "error" ? "alert" : undefined}
      style={[styles.banner, bannerToneStyle(tone)]}
    >
      {Children.map(children, (child) =>
        typeof child === "string" || typeof child === "number" ? (
          <Text style={styles.bannerText}>{child}</Text>
        ) : (
          child
        ),
      )}
    </View>
  );
}

export function StatusPill({
  tone,
  label,
  testID,
}: {
  tone: Tone;
  label: string;
  testID?: string;
}) {
  return (
    <View style={styles.pill} testID={testID}>
      <View style={[styles.dot, dotStyle(tone)]} />
      <Text style={styles.pillText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function dotStyle(tone: Tone) {
  switch (tone) {
    case "ok":
      return styles.dotOk;
    case "busy":
      return styles.dotBusy;
    case "error":
      return styles.dotError;
    case "idle":
      return styles.dotIdle;
    default:
      return styles.dotMuted;
  }
}

/** A centered question with explicit buttons. It appears at once (no animation). */
export function CenteredDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive,
  busy,
  onConfirm,
  onCancel,
  testID,
  confirmDisabled,
  children,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
  confirmDisabled?: boolean;
  /** A form or a list between the message and the buttons. */
  children?: ReactNode;
}) {
  const stop = useCallback(() => undefined, []);
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel={cancelLabel}>
        <Pressable style={styles.dialog} onPress={stop} testID={testID} accessibilityRole="none">
          <Text style={styles.dialogTitle} accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.dialogMessage}>{message}</Text>
          {children}
          <View style={styles.dialogButtons}>
            <Button
              variant="ghost"
              size="sm"
              onPress={onCancel}
              testID={testID ? `${testID}-cancel` : undefined}
            >
              {cancelLabel}
            </Button>
            <Button
              variant={destructive ? "destructive" : "default"}
              size="sm"
              loading={busy}
              disabled={confirmDisabled}
              onPress={onConfirm}
              testID={testID ? `${testID}-confirm` : undefined}
            >
              {confirmLabel}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A centered message; children (a button) go under it. */
export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  fill: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  column: {
    paddingTop: theme.spacing[4],
    width: "100%",
    maxWidth: 880 + 2 * theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[4],
    flex: 1,
    alignSelf: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  bannerError: {
    borderColor: theme.colors.statusDanger,
    backgroundColor: theme.colors.statusDangerTint,
  },
  bannerOk: {
    borderColor: theme.colors.statusSuccess,
    backgroundColor: theme.colors.statusSuccessTint,
  },
  bannerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  pillText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotOk: { backgroundColor: theme.colors.statusSuccess },
  dotBusy: { backgroundColor: theme.colors.statusWarning },
  dotError: { backgroundColor: theme.colors.statusDanger },
  dotIdle: { backgroundColor: theme.colors.accent },
  dotMuted: { backgroundColor: theme.colors.foregroundExtraMuted },
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  dialog: {
    width: "100%",
    maxWidth: 420,
    padding: theme.spacing[6],
    gap: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  dialogTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  dialogMessage: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  dialogButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  empty: {
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[8],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  emptyHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
