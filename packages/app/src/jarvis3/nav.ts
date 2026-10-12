// Where the chat-style app's routes sit (tested in nav.test.ts): top-level screens open from the
// sidebar (a drawer on phones, pinned on wide windows) and replace each other; detail screens are
// pushed from a screen and go back with a back button or the iOS swipe. On phones a detail screen
// has no drawer, so the drawer's swipe never fights the back swipe.

export const NEW_CHAT_HREF = "/";
export const chatHref = (taskId: string) => `/chats/${encodeURIComponent(taskId)}`;

/** Detail routes (Expo Router names): pushed with the platform's push animation. */
export const PUSHED_ROUTE_NAMES: ReadonlySet<string> = new Set([
  "(jarvis)/approvals/[approvalId]",
  "(jarvis)/scheduled/new",
  "(jarvis)/scheduled/[scheduleId]",
  "(jarvis)/projects/new",
  "(jarvis)/projects/[projectId]",
  "(jarvis)/channels/[taskId]",
  "(jarvis)/search/[taskId]",
  "(jarvis)/me/notifications",
]);

const TOP = [
  /^\/$/,
  /^\/chats\/[^/]+$/,
  /^\/approvals$/,
  /^\/files$/,
  /^\/scheduled$/,
  /^\/projects$/,
  /^\/notices$/,
  /^\/search$/,
  /^\/me\/layer$/,
  /^\/me\/usage$/,
  /^\/admin\/users$/,
];

const DETAIL = [
  /^\/approvals\/[^/]+$/,
  /^\/scheduled\/[^/]+$/,
  /^\/projects\/[^/]+$/,
  /^\/channels\/[^/]+$/,
  /^\/search\/[^/]+$/,
  /^\/me\/notifications$/,
];

export type RouteKind = "top" | "detail" | null;

/** A jarvis3 route's kind; null for anything else (Paseo's own routes). */
export function routeKind(pathname: string): RouteKind {
  const path = pathname.split(/[?#]/)[0] || "/";
  if (TOP.some((re) => re.test(path))) return "top";
  if (DETAIL.some((re) => re.test(path))) return "detail";
  return null;
}

/**
 * Whether the app chrome (the sidebar) is on for this route: everywhere on a wide window, only on
 * top-level screens on a phone, and only once the person is signed in.
 */
export function showsSidebar(input: {
  pathname: string;
  compact: boolean;
  signedIn: boolean;
}): boolean {
  if (!input.signedIn) return false;
  const kind = routeKind(input.pathname);
  if (kind === null) return false;
  return input.compact ? kind === "top" : true;
}

/** The sidebar entry a route belongs to (for its highlight), or null. */
export function currentSection(pathname: string): string | null {
  const path = pathname.split(/[?#]/)[0] || "/";
  const first = path.split("/")[1] ?? "";
  switch (first) {
    case "":
      return "new";
    case "chats":
    case "channels":
      return "chats";
    case "approvals":
    case "files":
    case "scheduled":
    case "projects":
    case "notices":
    case "search":
      return first;
    default:
      return null;
  }
}
