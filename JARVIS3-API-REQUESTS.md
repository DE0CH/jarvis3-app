# API changes the jarvis3 app variant asked of the Jarvis 3 server

All requests so far are done (DE0CH/jarvis3, 2026-10-10; contract in its `docs/API.md` and
`server/src/api-types.ts`, vendored here as `packages/app/src/jarvis3/api-types.ts`). Put new
requests below, in priority order; whoever works on the server takes them from here.

## Done

1. **The task's agent id in `TaskView`** (`agentId`, reported by the session over
   `POST /api/session/status`). The chat opens that agent; the "oldest agent" guess is gone.
2. **An HTTP relay to the daemon** (`/api/tasks/:id/daemon/http/*`, same authorisation as the
   WebSocket, bearer added by the server, always a sandboxed download). File downloads use it
   (`src/jarvis3/download-hook.ts`).
3. **A stable error for a revoked device**: 403 `device_revoked` while the user is still active;
   403 `forbidden` once the account itself has no access. The sign-in screen says which.
4. **Unread notices**: `unreadNotices` in `GET /api/me`, `read` on each notice and
   `POST /api/notices/read`. The navigation shows the count; the Notices screen marks them read.

## Open

None.
