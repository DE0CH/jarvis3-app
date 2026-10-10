// Small building blocks for the Jarvis 3 screens, made of Paseo's own components and theme:
// the page frame with its navigation, a centered question dialog (never alert()/confirm(), never
// a bottom sheet), an inline banner and a status pill.
import { Children, type ReactNode, useCallback } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { usePathname, useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView } from "@/components/ui/scroll-view";
import { Button } from "@/components/ui/button";
import { approvalsLabel } from "./approvals";
import { noticesLabel, type Tone } from "./plan";
import { SCHEDULES_LABEL } from "./schedules";
import { useAccount } from "./hooks";

interface NavItem {
  href: string;
  label: string;
  testID: string;
}

const SCHEDULES_HREF = "/scheduled";
const TASKS_NAV: NavItem = { href: "/tasks", label: "Tasks", testID: "jarvis3-nav-tasks" };
const LAYER_NAV: NavItem = {
  href: "/me/layer",
  label: "My instructions & skills",
  testID: "jarvis3-nav-layer",
};
const SCHEDULES_NAV: NavItem = {
  href: SCHEDULES_HREF,
  label: SCHEDULES_LABEL,
  testID: "jarvis3-nav-schedules",
};
const ADMIN_NAV: NavItem = { href: "/admin/users", label: "Users", testID: "jarvis3-nav-admin" };
const NOTICES_HREF = "/notices";
const APPROVALS_HREF = "/approvals";

function isCurrent(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/tasks" && pathname.startsWith("/channels/")) return true;
  return (
    (href === "/tasks" || href === APPROVALS_HREF || href === SCHEDULES_HREF) &&
    pathname.startsWith(`${href}/`)
  );
}

export function Jarvis3Frame({
  title,
  actions,
  children,
  scroll = true,
  testID,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const account = useAccount();
  const notices: NavItem = {
    href: NOTICES_HREF,
    label: noticesLabel(account.me?.unreadNotices ?? 0),
    testID: "jarvis3-nav-notices",
  };
  const approvals: NavItem = {
    href: APPROVALS_HREF,
    label: approvalsLabel(account.me?.pendingApprovals ?? 0),
    testID: "jarvis3-nav-approvals",
  };
  // Scheduled tasks only on a server that has them (features.schedules).
  const scheduled = account.me?.features?.schedules ? [SCHEDULES_NAV] : [];
  const base = [TASKS_NAV, ...scheduled, approvals, LAYER_NAV, notices];
  const nav = account.me?.user.isAdmin ? [...base, ADMIN_NAV] : base;
  const body = <View style={styles.column}>{children}</View>;
  return (
    <View style={[styles.page, { paddingTop: insets.top }]} testID={testID}>
      <View style={styles.topBar}>
        <View style={styles.nav}>
          {nav.map((item) => {
            return <NavLink key={item.href} item={item} current={isCurrent(pathname, item.href)} />;
          })}
        </View>
        {account.me ? (
          <Text style={styles.who} numberOfLines={1}>
            {account.me.user.name || account.me.user.email}
          </Text>
        ) : null}
      </View>
      <View style={styles.titleRow}>
        <View style={styles.titleInner}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
            {title}
          </Text>
          {actions ? <View style={styles.actions}>{actions}</View> : null}
        </View>
      </View>
      {scroll ? (
        <ScrollView
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

function NavLink({ item, current }: { item: NavItem; current: boolean }) {
  const router = useRouter();
  const go = useCallback(() => router.navigate(item.href as Href), [router, item.href]);
  return (
    <Pressable
      accessibilityRole="link"
      testID={item.testID}
      onPress={go}
      style={[styles.navItem, current && styles.navItemCurrent]}
    >
      <Text style={[styles.navText, current && styles.navTextCurrent]}>{item.label}</Text>
    </Pressable>
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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  nav: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
    flexShrink: 1,
  },
  navItem: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  navItemCurrent: {
    backgroundColor: theme.colors.surface3,
  },
  navText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  navTextCurrent: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  who: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    maxWidth: 200,
    display: { xs: "none", md: "flex" },
  },
  titleRow: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[6],
    paddingBottom: theme.spacing[3],
    alignItems: "center",
  },
  titleInner: {
    width: "100%",
    maxWidth: 880,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
    flexShrink: 1,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[2],
    alignItems: "center",
  },
  scrollContent: {
    flexGrow: 1,
  },
  column: {
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
