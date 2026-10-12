// The jarvis3 app's sidebar, ChatGPT-style: New chat, Search, the other screens, the chats grouped
// by recency (each with Rename and Delete), and the profile menu at the bottom. Paseo's app chrome
// hosts it (app/_layout.tsx): a slide-in drawer from the menu button or a swipe on phones (Paseo's
// mobile panel, its gestures and motion), pinned on wide windows.
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { usePathname, useRouter, type Href } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Bell,
  CalendarClock,
  Folder,
  FolderGit2,
  MoreHorizontal,
  Search,
  ShieldCheck,
  SquarePen,
  X,
} from "lucide-react-native";
import { ScrollView } from "@/components/ui/scroll-view";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useCloseAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import { usePanelStore } from "@/stores/panel-store";
import type { Theme } from "@/styles/theme";
import type { TaskView } from "./api-types";
import { useChatActions } from "./chat-actions";
import { groupChats, isDeleted } from "./chats";
import { isJarvis3 } from "./config";
import { taskExtrasStore, tasksStore } from "./client";
import { useAccount, useDevice, useTaskExtras, useTasks } from "./hooks";
import { chatHref, currentSection, NEW_CHAT_HREF, showsSidebar } from "./nav";
import { SCHEDULES_LABEL } from "./schedules";
import { pruneTaskHosts } from "./task-host";

export const SIDEBAR_WIDTH = 272;

/** Whether this route shows the sidebar (see nav.ts showsSidebar). */
export function useJarvis3Chrome(pathname: string): boolean {
  const compact = useIsCompactFormFactor();
  const device = useDevice();
  const account = useAccount();
  if (!isJarvis3) return false;
  return showsSidebar({ pathname, compact, signedIn: device.paired && account.me !== null });
}

export const Jarvis3Sidebar = memo(function Jarvis3Sidebar({ active }: { active: boolean }) {
  const compact = useIsCompactFormFactor();
  return (
    <RetainedPanelActivity active={active}>
      {compact ? <MobileSidebar active={active} /> : <DesktopSidebar active={active} />}
    </RetainedPanelActivity>
  );
});

function MobileSidebar({ active }: { active: boolean }) {
  const insets = useSafeAreaInsets();
  const close = usePanelStore((state) => state.showMobileAgent);
  const { gesture } = useCloseAgentListGesture();
  const panelStyle = useMemo(
    () => [styles.mobilePanel, { paddingTop: insets.top, paddingBottom: insets.bottom }],
    [insets.top, insets.bottom],
  );
  return (
    <MobilePanelOverlay panel="agent-list" closeGesture={gesture} panelStyle={panelStyle}>
      <View style={styles.fill} pointerEvents="auto" testID="jarvis3-sidebar">
        <SidebarContent active={active} onNavigate={close} onClose={close} />
      </View>
    </MobilePanelOverlay>
  );
}

function DesktopSidebar({ active }: { active: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.desktop, { paddingTop: insets.top }, !active && styles.hidden]}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
      testID="jarvis3-sidebar"
    >
      <SidebarContent active={active} onNavigate={noop} onClose={null} />
    </View>
  );
}

const noop = () => undefined;

function SidebarContent({
  active,
  onNavigate,
  onClose,
}: {
  active: boolean;
  onNavigate: () => void;
  onClose: (() => void) | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const section = currentSection(pathname);
  const account = useAccount();
  const me = account.me;
  const features = me?.features;
  const tasks = useTasks();
  const actions = useChatActions();

  // The chat list stays fresh while the sidebar is shown.
  useEffect(() => {
    if (!active || !me) return undefined;
    tasksStore.activate();
    return () => tasksStore.deactivate();
  }, [active, me]);

  // Chats whose channel has posts the user hasn't read get a dot (refreshed with the list).
  const extras = useTaskExtras();
  const schedulesOn = features?.schedules === true;
  useEffect(() => {
    if (!active || !schedulesOn) return undefined;
    void taskExtrasStore.loadChannels();
    const timer = setInterval(loadChannels, 30_000);
    return () => clearInterval(timer);
  }, [active, schedulesOn, tasks.tasks]);
  const unread = useMemo(
    () => new Set(extras.channels.filter((c) => c.unread > 0).map((c) => c.taskId)),
    [extras.channels],
  );

  // Forget the Paseo hosts of deleted chats.
  const liveIds = useMemo(
    () =>
      tasks.tasks
        .filter((task) => !isDeleted(task))
        .map((task) => task.id)
        .join(","),
    [tasks.tasks],
  );
  useEffect(() => {
    if (!tasks.loaded || tasks.error) return;
    void pruneTaskHosts(new Set(liveIds ? liveIds.split(",") : []));
  }, [tasks.loaded, tasks.error, liveIds]);

  // Recency groups move at midnight: recompute every minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [active]);
  const groups = useMemo(() => groupChats(tasks.tasks, now), [tasks.tasks, now]);

  const go = useCallback(
    (href: string) => {
      onNavigate();
      router.replace(href as Href);
    },
    [onNavigate, router],
  );

  const items: NavItem[] = [
    { key: "search", href: "/search", label: "Search", Icon: ThemedSearch },
    {
      key: "approvals",
      href: "/approvals",
      label: "Approvals",
      Icon: ThemedApprovals,
      count: me?.pendingApprovals ?? 0,
    },
    ...(features?.projects
      ? [{ key: "projects", href: "/projects", label: "Projects", Icon: ThemedProjects }]
      : []),
    ...(features?.files
      ? [{ key: "files", href: "/files", label: "Files", Icon: ThemedFiles }]
      : []),
    ...(features?.schedules
      ? [{ key: "scheduled", href: "/scheduled", label: SCHEDULES_LABEL, Icon: ThemedSchedules }]
      : []),
    {
      key: "notices",
      href: "/notices",
      label: "Notices",
      Icon: ThemedNotices,
      count: me?.unreadNotices ?? 0,
    },
  ];
  const openChatId = section === "chats" ? (pathname.split("/")[2] ?? null) : null;

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <NewChatRow current={section === "new"} onGo={go} />
        {onClose ? (
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel="Close the sidebar"
            testID="jarvis3-sidebar-close"
          >
            <ThemedClose size={20} uniProps={muted} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.nav}>
        {items.map((item) => (
          <NavRow key={item.key} item={item} current={section === item.key} onGo={go} />
        ))}
      </View>
      <ScrollView style={styles.fill} contentContainerStyle={styles.list} testID="jarvis3-chats">
        {groups.map((group) => (
          <View key={group.label} style={styles.group}>
            <Text style={styles.groupLabel} accessibilityRole="header">
              {group.label}
            </Text>
            {group.chats.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                current={chat.id === openChatId}
                busy={tasks.pending[chat.id] !== undefined}
                unread={unread.has(chat.id)}
                onGo={go}
                onRename={actions.rename}
                onDelete={actions.remove}
              />
            ))}
          </View>
        ))}
        {tasks.loaded && groups.length === 0 ? (
          <Text style={styles.empty}>Your chats will appear here.</Text>
        ) : null}
      </ScrollView>
      <ProfileMenu onNavigate={go} />
      {actions.dialogs}
    </View>
  );
}

function loadChannels(): void {
  void taskExtrasStore.loadChannels();
}

/** A sidebar row's background: hover/press, and the current one. */
function useRowStyle(current: boolean, grow = false) {
  return useCallback(
    ({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
      styles.row,
      grow && styles.rowGrow,
      (hovered || pressed) && styles.rowHover,
      current && styles.rowCurrent,
    ],
    [current, grow],
  );
}

function NewChatRow({ current, onGo }: { current: boolean; onGo: (href: string) => void }) {
  const press = useCallback(() => onGo(NEW_CHAT_HREF), [onGo]);
  const style = useRowStyle(current, true);
  return (
    <Pressable onPress={press} style={style} accessibilityRole="button" testID="jarvis3-new-chat">
      <ThemedNewChat size={18} uniProps={foreground} />
      <Text style={styles.rowText}>New chat</Text>
    </Pressable>
  );
}

interface NavItem {
  key: string;
  href: string;
  label: string;
  Icon: typeof ThemedSearch;
  count?: number;
}

function NavRow({
  item,
  current,
  onGo,
}: {
  item: NavItem;
  current: boolean;
  onGo: (href: string) => void;
}) {
  const { Icon } = item;
  const count = item.count ?? 0;
  const press = useCallback(() => onGo(item.href), [onGo, item.href]);
  const style = useRowStyle(current);
  return (
    <Pressable
      onPress={press}
      style={style}
      accessibilityRole="link"
      testID={`jarvis3-nav-${item.key}`}
    >
      <Icon size={18} uniProps={current ? foreground : muted} />
      <Text style={[styles.rowText, !current && styles.rowTextMuted]}>{item.label}</Text>
      {count > 0 ? (
        <View style={styles.count}>
          <Text style={styles.countText} testID={`jarvis3-nav-${item.key}-count`}>
            {count > 99 ? "99+" : String(count)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ChatRow({
  chat,
  current,
  busy,
  unread,
  onGo,
  onRename,
  onDelete,
}: {
  chat: TaskView;
  current: boolean;
  busy: boolean;
  unread: boolean;
  onGo: (href: string) => void;
  onRename: (chat: TaskView) => void;
  onDelete: (chat: TaskView) => void;
}) {
  const compact = useIsCompactFormFactor();
  const [hovered, setHovered] = useState(false);
  const showMenu = hovered || current || isNative || compact;
  const open = useCallback(() => onGo(chatHref(chat.id)), [onGo, chat.id]);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const rename = useCallback(() => onRename(chat), [onRename, chat]);
  const remove = useCallback(() => onDelete(chat), [onDelete, chat]);
  const style = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.chatRow,
      (hovered || pressed) && styles.rowHover,
      current && styles.rowCurrent,
      busy && styles.busy,
    ],
    [hovered, current, busy],
  );
  return (
    <Pressable
      onPress={open}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={style}
      accessibilityRole="link"
      accessibilityLabel={unread ? `${chat.title}, new channel posts` : chat.title}
      testID={`jarvis3-chat-row-${chat.id}`}
    >
      <Text style={styles.chatTitle} numberOfLines={1}>
        {chat.title}
      </Text>
      {unread ? <View style={styles.dot} testID={`jarvis3-chat-unread-${chat.id}`} /> : null}
      <View style={[styles.kebabSlot, !showMenu && styles.invisible]}>
        <DropdownMenu>
          <DropdownMenuTrigger
            hitSlop={8}
            style={styles.kebab}
            accessibilityRole="button"
            accessibilityLabel={`Actions for ${chat.title}`}
            testID={`jarvis3-chat-menu-${chat.id}`}
          >
            <ThemedMore size={16} uniProps={muted} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" width={180}>
            <DropdownMenuItem onSelect={rename} testID={`jarvis3-chat-rename-${chat.id}`}>
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              destructive
              onSelect={remove}
              testID={`jarvis3-chat-delete-${chat.id}`}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
    </Pressable>
  );
}

function MenuLink({
  href,
  onNavigate,
  testID,
  children,
}: {
  href: string;
  onNavigate: (href: string) => void;
  testID: string;
  children: string;
}) {
  const select = useCallback(() => onNavigate(href), [onNavigate, href]);
  return (
    <DropdownMenuItem onSelect={select} testID={testID}>
      {children}
    </DropdownMenuItem>
  );
}

function ProfileMenu({ onNavigate }: { onNavigate: (href: string) => void }) {
  const me = useAccount().me;
  if (!me) return null;
  const name = me.user.name || me.user.email;
  const initials =
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?";
  return (
    <View style={styles.footer}>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={styles.profile}
          accessibilityRole="button"
          accessibilityLabel="Account and settings"
          testID="jarvis3-profile-menu"
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.profileName} numberOfLines={1}>
            {name}
          </Text>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" width={240}>
          <MenuLink href="/me/layer" onNavigate={onNavigate} testID="jarvis3-menu-layer">
            My instructions & skills
          </MenuLink>
          <MenuLink href="/me/usage" onNavigate={onNavigate} testID="jarvis3-menu-usage">
            Usage this month
          </MenuLink>
          {me.features?.push ? (
            <MenuLink
              href="/me/notifications"
              onNavigate={onNavigate}
              testID="jarvis3-menu-notifications"
            >
              Notification settings
            </MenuLink>
          ) : null}
          {me.user.isAdmin ? (
            <MenuLink href="/admin/users" onNavigate={onNavigate} testID="jarvis3-menu-admin">
              Users and tools
            </MenuLink>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

const ThemedNewChat = withUnistyles(SquarePen);
const ThemedSearch = withUnistyles(Search);
const ThemedApprovals = withUnistyles(ShieldCheck);
const ThemedProjects = withUnistyles(FolderGit2);
const ThemedFiles = withUnistyles(Folder);
const ThemedSchedules = withUnistyles(CalendarClock);
const ThemedNotices = withUnistyles(Bell);
const ThemedMore = withUnistyles(MoreHorizontal);
const ThemedClose = withUnistyles(X);
const foreground = (theme: Theme) => ({ color: theme.colors.foreground });
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const styles = StyleSheet.create((theme) => ({
  fill: {
    flex: 1,
  },
  mobilePanel: {
    backgroundColor: theme.colors.surfaceSidebar,
  },
  desktop: {
    width: SIDEBAR_WIDTH,
    backgroundColor: theme.colors.surfaceSidebar,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  hidden: {
    display: "none",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[3],
  },
  close: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  nav: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[2],
    gap: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    minHeight: 40,
  },
  rowGrow: {
    flex: 1,
  },
  rowHover: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  rowCurrent: {
    backgroundColor: theme.colors.surface2,
  },
  rowText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowTextMuted: {
    color: theme.colors.foregroundMuted,
  },
  count: {
    minWidth: 20,
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 1,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    alignItems: "center",
  },
  countText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  list: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[3],
  },
  group: {
    gap: 2,
  },
  groupLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  chatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    minHeight: 40,
  },
  chatTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  busy: {
    opacity: 0.5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  kebabSlot: {
    width: 32,
    alignItems: "center",
  },
  invisible: {
    opacity: 0,
  },
  kebab: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[4],
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    padding: theme.spacing[2],
  },
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  profileName: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));
