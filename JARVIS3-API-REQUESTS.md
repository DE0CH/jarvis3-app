# API changes the jarvis3 app variant would like from the Jarvis 3 server

The app works against the API as it stands (`docs/API.md` in DE0CH/jarvis3, vendored types in
`packages/app/src/jarvis3/api-types.ts`). These are improvements, in priority order. This repo
doesn't edit jarvis3; whoever works on the server takes them from here.

1. **The task's agent id in `TaskView`** (for example `agentId: string | null`, reported by the
   session over `POST /api/session/status` once the session image has created the agent for the
   first prompt).
   Today the chat screen guesses: the oldest top-level, non-archived agent on the task's daemon
   (`pickTaskAgent` in `plan.ts`). That breaks if a session ever starts a helper agent first.

2. **An HTTP relay to the daemon next to the WebSocket one** (for example
   `/api/tasks/:id/daemon/http/*`, with the same authorisation, the bearer added by the server).
   Paseo fetches some things over the daemon's HTTP rather than the WebSocket, mainly file
   downloads (`stores/download-store.ts`). Through the proxy, those requests have nowhere to go,
   so downloading a file the agent produced fails in this variant. Everything in the chat itself
   goes over the WebSocket and works.

3. **A stable error for "this device was revoked"**. Today a revoked device token is refused by
   Cloudflare Access (a redirect to its login page), which looks the same as an expired or
   still-propagating token. The app forgets the token after the 30 s propagation grace. That's
   right, but a revoked token that Access still accepts would answer 403 `forbidden`, the same as
   a suspended user. A distinct code (or a `GET /api/me` field) would let the app say which it is.

4. **Notices in the list view**. `GET /api/notices` exists. Cap and budget pauses already show on
   the task (`pausedReason`), so v1 of the app doesn't show notices. A `unread` count in
   `GET /api/me` would let it show a badge without polling the list.
