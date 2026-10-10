// The mock instance's push notifications (docs/API.md section 16 in DE0CH/jarvis3): per-user
// kinds and subscriptions with the server's rules (an endpoint on a known push service, an
// address registered again moves to the caller, someone else's subscription is a 404). Nothing is
// really sent: "Send test" records each push. Never deploy this.
import type {
  CreatePushSubscriptionRequest,
  ErrorCode,
  PushKind,
  PushKindView,
  PushSettings,
  PushSubscriptionView,
} from "../src/jarvis3/api-types";

interface Caller {
  id: string;
  isAdmin: boolean;
}
interface Ctx {
  user: Caller;
  params: string[];
  body: () => Promise<unknown>;
}
type Handler = (ctx: Ctx) => [number, unknown] | Promise<[number, unknown]>;
type Route = [method: string, pattern: RegExp, handler: Handler];

const KINDS: { kind: PushKind; label: string }[] = [
  { kind: "approval_needed", label: "Approvals waiting for you" },
  { kind: "question", label: "Questions for you (ask the boss)" },
  { kind: "approval_decided", label: "Your requests decided" },
  { kind: "channel_post", label: "New posts in your tasks' channels" },
  { kind: "caps", label: "Caps and budget reached" },
  { kind: "schedule_skipped", label: "Scheduled runs skipped" },
  { kind: "wakeup", label: "Wakeups that couldn't run" },
  { kind: "task_failed", label: "Tasks that failed to start" },
  { kind: "other", label: "Other notices (access, suggestions, passkeys)" },
];
const HOSTS = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];
/** A VAPID-shaped public key (65 bytes, uncompressed point prefix); the mock never signs with it. */
export const MOCK_VAPID_PUBLIC_KEY = Buffer.concat([
  Buffer.from([4]),
  Buffer.alloc(64, 7),
]).toString("base64url");

interface StoredSub extends PushSubscriptionView {
  userId: string;
  address: string;
}

export function createMockPush(deps: {
  fail: (status: number, code: ErrorCode, message: string) => Error;
  log?: (line: string) => void;
}) {
  const subs: StoredSub[] = [];
  const prefs = new Map<string, Map<PushKind, boolean>>();
  const sent: { userId: string; subscriptionId: string; title: string }[] = [];
  let n = 0;

  const view = ({ userId: _u, address: _a, ...s }: StoredSub): PushSubscriptionView => s;
  const settings = (userId: string): PushSettings => {
    const p = prefs.get(userId) ?? new Map();
    const kinds: PushKindView[] = KINDS.map((k) => ({ ...k, enabled: p.get(k.kind) ?? true }));
    return {
      apns: true,
      webPushPublicKey: MOCK_VAPID_PUBLIC_KEY,
      kinds,
      subscriptions: subs.filter((s) => s.userId === userId).map(view),
    };
  };
  const hostOk = (endpoint: string) => {
    try {
      const u = new URL(endpoint);
      return (
        u.protocol === "https:" &&
        HOSTS.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))
      );
    } catch {
      return false;
    }
  };

  const routes: Route[] = [
    ["GET", /^\/api\/push$/, ({ user }) => [200, settings(user.id)]],
    [
      "PUT",
      /^\/api\/push\/kinds$/,
      async ({ user, body }) => {
        const { kinds } = (await body()) as { kinds: Record<string, unknown> };
        const p = prefs.get(user.id) ?? new Map<PushKind, boolean>();
        for (const [k, v] of Object.entries(kinds ?? {})) {
          if (!KINDS.some((x) => x.kind === k) || typeof v !== "boolean")
            throw deps.fail(400, "bad_request", `bad kind ${k}`);
          p.set(k as PushKind, v);
        }
        prefs.set(user.id, p);
        return [200, settings(user.id)];
      },
    ],
    [
      "POST",
      /^\/api\/push\/subscriptions$/,
      async ({ user, body }) => {
        const r = (await body()) as CreatePushSubscriptionRequest;
        let address: string;
        if (r.kind === "web") {
          if (!hostOk(r.endpoint))
            throw deps.fail(
              400,
              "bad_request",
              "endpoint must be an https URL on a known push service",
            );
          address = r.endpoint;
        } else if (r.kind === "apns") {
          if (!/^[0-9a-f]{64,200}$/.test(String(r.token).toLowerCase()))
            throw deps.fail(400, "bad_request", "token must be hex");
          address = r.token.toLowerCase();
          // the simulator test reads the token from the mock's log
          deps.log?.(`[mock-instance] push subscription apns token=${address}`);
        } else throw deps.fail(400, "bad_request", "kind must be web or apns");
        const existing = subs.find((s) => s.address === address);
        if (existing) {
          existing.userId = user.id;
          existing.label = r.label ?? existing.label;
          return [201, view(existing)];
        }
        const s: StoredSub = {
          id: `sub${++n}`,
          kind: r.kind,
          label: r.label ?? (r.kind === "apns" ? "iPhone" : "Browser"),
          deviceId: null,
          createdAt: new Date().toISOString(),
          lastSentAt: null,
          lastOkAt: null,
          lastError: null,
          userId: user.id,
          address,
        };
        subs.push(s);
        return [201, view(s)];
      },
    ],
    [
      "DELETE",
      /^\/api\/push\/subscriptions\/([^/]+)$/,
      ({ user, params }) => {
        const i = subs.findIndex(
          (s) => s.id === params[0] && (s.userId === user.id || user.isAdmin),
        );
        if (i < 0) throw deps.fail(404, "not_found", "no such subscription");
        subs.splice(i, 1);
        return [200, { ok: true }];
      },
    ],
    [
      "POST",
      /^\/api\/push\/test$/,
      ({ user }) => {
        const mine = subs.filter((s) => s.userId === user.id);
        const at = new Date().toISOString();
        for (const s of mine) {
          s.lastSentAt = at;
          s.lastOkAt = at;
          sent.push({ userId: user.id, subscriptionId: s.id, title: "Test notification" });
        }
        return [200, { results: mine.map((s) => ({ id: s.id, ok: true, error: null })) }];
      },
    ],
  ];

  return { routes, state: { pushSubscriptions: subs, pushSent: sent, pushPrefs: prefs } };
}
