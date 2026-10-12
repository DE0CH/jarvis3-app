// Jarvis 3 (APP_VARIANT=jarvis3) push service worker: shows each Web Push from the instance and
// opens its screen when tapped. A push carries a fixed title, the unread count and ids only
// (docs/API.md section 16 in DE0CH/jarvis3); the app fetches the notice itself.
// targetFor() mirrors noticeTarget() in src/jarvis3/schedules.ts (checked by push.test.ts).

function targetFor(data) {
  if (!data || typeof data !== "object") return "/notices";
  if (data.jarvis3 === "test") return "/me/notifications";
  const kind = data.kind;
  if (kind === "approval_needed") {
    return data.approvalId ? `/approvals/${encodeURIComponent(data.approvalId)}` : "/approvals";
  }
  if (kind === "schedule_skipped") return "/scheduled";
  if (!data.taskId) return "/notices";
  const id = encodeURIComponent(data.taskId);
  if (kind === "channel_post") return `/channels/${id}`;
  return `/chats/${id}`;
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let p = {};
  try {
    p = event.data ? event.data.json() : {};
  } catch {
    p = {};
  }
  const title = typeof p.title === "string" && p.title ? p.title : "Jarvis";
  const options = {
    body: typeof p.body === "string" ? p.body : "Open Jarvis to see it.",
    tag: typeof p.tag === "string" ? p.tag : undefined,
    data: p.data && typeof p.data === "object" ? p.data : {},
    icon: "/pwa-icon-192.png",
    badge: "/pwa-icon-192.png",
  };
  const shows = [self.registration.showNotification(title, options)];
  if (typeof p.badge === "number" && self.navigator && self.navigator.setAppBadge) {
    shows.push(self.navigator.setAppBadge(p.badge).catch(() => undefined));
  }
  // windows that are open learn about it (the e2e test and the app's unread count listen)
  shows.push(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Client.postMessage has no targetOrigin
        c.postMessage({ jarvis3Push: { title, data: options.data } });
      }
      return undefined;
    }),
  );
  event.waitUntil(Promise.all(shows));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = targetFor(event.notification.data);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const own = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (own) {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Client.postMessage has no targetOrigin
        own.postMessage({ jarvis3Open: route });
        return own.focus();
      }
      return self.clients.openWindow(route);
    }),
  );
});
