# Jarvis 3 app

This repo is [getpaseo/paseo](https://github.com/getpaseo/paseo) (Apache-2.0) with full history plus
one build variant, `APP_VARIANT=jarvis3`, which is the front end of a Jarvis 3 instance
([DE0CH/jarvis3](https://github.com/DE0CH/jarvis3); API contract in its `docs/API.md` and
`server/src/api-types.ts`). One codebase gives the instance's web page and an iOS app. Every other
variant builds plain Paseo, unchanged.

- `origin` = DE0CH/jarvis3-app; `upstream` = getpaseo/paseo. Upstream comes in by merge commits;
  `main` only moves forward and is never force-pushed. To see everything this repo changes:
  `git diff upstream/main...main`.
- All jarvis3 code is in `packages/app/src/jarvis3/`, `packages/app/src/app/(jarvis)/` and
  `packages/app/e2e-jarvis3/`. Upstream files only get the hooks listed below.
- CI: `.github/workflows/jarvis3.yml` (typecheck, the app's unit tests, upstream's CI-contract
  tests, a web build of the variant and its Playwright e2e) and `.github/workflows/jarvis3-ios.yml`
  (the iOS app: a simulator test against the mock instance, and a TestFlight build; see
  [Shipping the iOS app](#shipping-the-ios-app)).
  Upstream's own workflows are disabled in this repo: they deploy, release or need
  getpaseo's secrets, and their full CI is too heavy for a private repo's minutes.

## What the variant is

A chat app like the ChatGPT and Claude apps. The server calls a chat a **task**; the app says
**chat** everywhere and never shows machines, pausing, resuming or destroying. Chats keep pausing
on idle server-side; typing into a sleeping chat wakes it.

**The shell.** A ChatGPT-style sidebar (`src/jarvis3/sidebar.tsx`): New chat, Search, Approvals
(with its count), Projects, Files, Schedules, Notices (with the unread count), then the chats
grouped by recency (Today, Yesterday, Previous 7 days, Previous 30 days, month names, then years;
sorted by `TaskView.lastActivityAt`), each with a menu of **Rename** and **Delete**, and a dot when
its channel has unread posts. At the bottom, the profile menu: My instructions & skills, Usage this
month, Notification settings, and for admins Users and tools. Paseo's app chrome hosts it
(`app/_layout.tsx`): pinned on a wide window (Paseo's desktop layout, 720 px and up), and on a phone
the slide-in drawer from the menu button or a swipe (Paseo's mobile panel, its gestures and
motion). Top-level screens replace each other from the sidebar; detail screens (an approval, a
schedule, a Project, a channel, a transcript, notification settings) are pushed with the native
push and swipe-back, and on a phone have a back button and no drawer (`src/jarvis3/nav.ts`).

| Screen                   | Route               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New chat                 | `/`                 | Where the app opens: "What can I help with?" and the composer, focused (the keyboard up on a phone). The composer: the text, an attach button (Upload files, or From my Files: a centered dialog), the model picker (`GET /api/models`) and the Projects picker (several per chat). Send = `POST /api/tasks` with the text as `prompt`, a `requestId` (a double press makes one chat), the model, `attachments` (uploaded first to `attachments/<requestId>/<name>`) and `projects`; the chat shows in the sidebar at once and opens.                                                                                                                                                                                                                                                                                                  |
| Chat                     | `/chats/:id`        | While the chat's agent is connected: Paseo's own conversation panel (`AgentConversationPanel`) for the task's agent, on the task's host, without the workspace chrome; its tool calls are **step chips** in plain words ("Searched the web", "Ran a command", `src/jarvis3/steps.ts`) that expand in place. Otherwise (starting, or asleep): the conversation as the instance indexed it (`GET /api/tasks/:id/transcript`, the latest 100 entries) drawn with Paseo's message components, what this app just sent, a quiet "Starting…" while the agent wakes, and a composer; a message goes to `POST /api/tasks/:id/messages`, which wakes a sleeping chat. The header: the title and its menu (Rename, Delete), the Projects it uses; "Waiting on you" when it asked for an approval; a line with its channel posts and next wakeup. |
| Search                   | `/search`           | Chats whose title matches, as you type; and transcript search over the user's own chats (`GET /api/search`), deleted ones too, when `me.features.search` is on: hits grouped by chat with the matched words highlighted; admins can switch to everyone's chats (`all=1`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Transcript               | `/search/:id`       | A chat's indexed conversation around a hit (`GET /api/tasks/:id/transcript?around=&agentId=`), opened scrolled to the hit, with earlier/later pages; **Open chat** when the chat isn't deleted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Projects                 | `/projects`         | The person's own Projects and the shared ones their role may use (`GET /api/projects`). **New Project** / a Project's page (`/projects/new`, `/projects/:id`): name, description, repos (an https address, a branch, and for a private repo which secret holds its token), secrets (write-only: a stored value is never shown, typing replaces it, Remove deletes it), and for an admin's new Project, Shared with roles. Staff see a shared Project read-only. Delete is a centered dialog.                                                                                                                                                                                                                                                                                                                                           |
| Files                    | `/files`            | The user's files (`GET /api/users/me/files`), when `me.features.files` is on: folders implied by paths (`?dir=`, breadcrumb), size, date, "Saved by a chat"; Upload into the open folder, Download (a short-lived link, `?link=1`, opened in a new tab or the browser), Rename/move (a path with folders), Delete (centered dialog); usage against the quota. An admin opens a person's files read-only with `?user=<id>` (from the Users page).                                                                                                                                                                                                                                                                                                                                                                                       |
| My instructions & skills | `/me/layer`         | The personal layer: instructions, skills (SKILL.md editor), notes; delete; **Reset to company default** (centered dialog) with **Undo**. Every change says it applies from the next chat. When `me.features.suggestions` is on, **Suggest for everyone** on a skill, the instructions or a note opens a pull request on the org-env repo; the list shows each one's link and state.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Usage this month         | `/me/usage`         | The user's own model-spend limit, machine time, and (when the instance has Tier 0 tools) web search/fetch spend and proxy GB against their caps, from `GET /api/me`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Notices                  | `/notices`          | The instance's notices (a cap stopped a chat, a chat couldn't start, access removed), newest first; opening the screen marks them read. The sidebar shows the unread count (`unreadNotices` in `GET /api/me`, refreshed every minute).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Notifications            | `/me/notifications` | Push notifications (when `me.features.push`; from the profile menu or Notices): this device **Turn on**/**Turn off** (the iOS app through APNs, a browser or a Home Screen web app through Web Push, `POST /api/push/subscriptions`), **Send test**, a switch per kind (`PUT /api/push/kinds`, switched on the server's answer), and every device that gets the person's pushes with **Remove**. Safari on iPhone outside the Home Screen is told to add the web app first. A tapped push opens the notice's screen.                                                                                                                                                                                                                                                                                                                   |
| Schedules                | `/scheduled`        | Scheduled chats (`GET /api/schedules`; shown when `me.features.schedules`): each one's repeat in words, time zone, next run and last run's outcome; an On/Off switch and **Run now**. **New schedule** / a schedule's page (`/scheduled/new`, `/scheduled/:id`): title, prompt, model, Repeat (every day / weekday / week / month / hour, or a cron expression), time, time zone (the device's by default; the schedule keeps it), with the next five runs from `POST /api/schedules/preview`; Save, Run now, Delete (centered dialog) and the run history with links to the chats.                                                                                                                                                                                                                                                    |
| Channel                  | `/channels/:taskId` | A chat's channel: the posts its agent made (`jarvis_post`), newest first, rendered as markdown; opening it marks them read. Its wakeups: what each waits for, in words, its state, and **Cancel** (centered dialog). **Wake this chat at…** (the owner, a chat that hasn't ended): a date and time on the device's clock and an optional message, `POST /api/tasks/:id/wakeups`; it shows as "(set by you)". Reached from the chat's one-line summary, the sidebar's dot, and a `channel_post` notice.                                                                                                                                                                                                                                                                                                                                 |
| Approvals                | `/approvals`        | The approval queue and one page per approval (`/approvals/:id`); the owner's passkeys at the bottom.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Users (admins only)      | `/admin/users`      | Each user's monthly model-spend and machine-hour limits and use, with "At cap" when the machine-hour cap is reached; when the instance has Tier 0 tools, also web-tools spend and proxy GB with "Tools at cap", and a card with the providers and everyone's totals against the instance cap (`GET /api/admin/tools`); set or clear a per-user override (`PATCH /api/users/:id/limits`). **Chats & layer** shows a person's chats (archive download for deleted ones) and personal layer, kept after offboarding. Everyone's suggestions with link and state.                                                                                                                                                                                                                                                                          |

Hidden in this variant: everything of Paseo's host model, and every machine state. The app never
shows the welcome/pairing screen, never auto-adds a `localhost:6767` daemon, and its routes don't
mount Paseo's host sidebar (no manual pairing, QR, host settings or daemon pairing). The chat is
the bare conversation panel: no git/review panels, terminal, file explorer or workspace header, and
no model/mode pickers in its composer (the model is picked when the chat starts).

UI rules: Paseo's own components and theme (Button, the Settings cards and rows, DropdownMenu as a
popover, its message components, its headers); questions are a centered dialog, never
`alert()`/`confirm()` and never a bottom sheet (a step's details expand in place on phones too, and
the attach menu is a popover); notices are inline banners.

## How a task becomes a Paseo host

- The instance relays the daemon WebSocket at `wss://<instance>/api/tasks/<id>/daemon`. It checks
  the owner (or an admin) on every upgrade and adds `paseo.bearer.<daemon password>` itself. The
  daemon admits a socket that carries a header credential without a password in `hello`, so the app
  never holds the password.
- **Finding (verified in code):** Paseo's direct host can't take a full `wss` URL with a path.
  `buildDaemonWebSocketUrl` always builds `ws(s)://host:port/ws`, the stored host registry rewrites
  every direct connection's id to `direct:<endpoint>`, and hosts that share an endpoint are merged.
  Each task therefore gets its own pseudo-endpoint, `t-<taskId>.jarvis3.invalid:443` (the reserved
  `.invalid` TLD). One hook in the two URL builders turns it into the proxy URL
  (`src/jarvis3/daemon-endpoint.ts`).
- The serverId is the daemon's own. The app learns it when the task is first opened, by probing
  through the proxy (`HostRuntimeStore.probeAndUpsertConnection`). A paused task keeps its host,
  because a resumed daemon keeps its id. The sidebar removes the hosts of deleted chats.
- The chat shows the task's own agent: the id the session reports (`TaskView.agentId`), once the
  task's host has that agent. Until then the screen says it is waiting for the agent.
- File downloads go through the instance's HTTP relay to the daemon
  (`/api/tasks/<id>/daemon/http/api/files/download?token=…`, `src/jarvis3/download-hook.ts`);
  the instance adds the daemon password and always answers as a download.
- The embedded chat does what the workspace screen does for visible agents: it prepares the agent's
  timeline and marks the agent viewed and focused. Without that the panel stays on its spinner.
- **Auth.** On the web, the page is on the instance's origin, so the browser's Cloudflare Access
  cookie authenticates both the API and the WebSocket. On iOS, the device token from pairing goes
  out as `CF-Access-Client-Id/Secret`: on API calls, and on the daemon WebSocket through the
  native websocket-factory hook. React Native's WebSocket accepts headers.
- **iOS pairing** (the pattern of the earlier Jarvis integration in DE0CH/paseo). The app opens
  `GET <instance>/api/devices/pair?state&name&model` in the system sign-in sheet
  (`expo-web-browser`). The instance redirects to `<scheme>://paired?…`, and the token is kept in
  the Keychain (`expo-secure-store`). A token is refused for about 30 s after it's minted
  (Cloudflare propagation), and the app retries during that window. The instance answers 403
  `device_revoked` for a token revoked while its user is still active: the app forgets it at once
  and says so on the sign-in screen. A 403 `forbidden` means the account itself has no access
  (suspended or removed); the app forgets the token after the grace period and says that instead. A CI simulator run can pass a token as the
  launch arguments `-jarvis3E2EClientId … -jarvis3E2EClientSecret …`.

## Code

- `api-types.ts`: vendored from jarvis3 (type-only). Refresh it with `scripts/jarvis3-sync-api-types.sh`.
- `chats.ts`: the chat app's decisions: which tasks the sidebar lists and their recency groups,
  title search, what the chat screen shows (`planChatView`: live, or history with "Starting…"),
  which sent messages the history doesn't hold yet, transcript tool lines as steps. `chat-store.ts`:
  messages sent from this app to a chat that isn't live (a new chat's first one, a reply to a
  sleeping chat), shown until the conversation has them. `steps.ts`: step chips' words. `nav.ts`:
  routes (top-level or pushed detail), where the sidebar shows, the sidebar's highlight.
  `projects.ts`: the Project form's logic (draft <-> request, checks) and the Projects store.
  All unit-tested (`*.test.ts`).
- `plan.ts`: pure decisions (the chat's agent, error messages and sign-out reasons, pairing
  redirect, skill validation, limit input, the notices label, usage rows).
- `schedules.ts`: scheduled chats, wakeups and channels: the schedule form's logic (repeat <-> cron,
  checks, the request), run/wakeup labels, notice targets, and the schedules and channel/wakeup
  stores (unit-tested in `schedules.test.ts`). Upstream Paseo owns `/schedules` (its own host
  schedules), so the variant's page is `/scheduled`.
- `api.ts`: the API client (fetch, base URL and credentials injected; the device's zone goes out as
  `X-Time-Zone` on every call). Uploads stream: on the web the picked `File` is the fetch body (the
  browser reads it from disk); on iOS `upload-file.native.ts` PUTs the picked file from disk with
  `expo-file-system/legacy`'s `uploadAsync`. Neither reads the file into JS memory.
- `pick-files.ts` / `pick-files.web.ts`: the variant's own file picker. Paseo's `use-file-picker`
  reads each file's bytes (its chat attachments need them), so uploads don't use it. `stores.ts`: the
  tasks (chats: rename, delete, kept fresh while the sidebar shows), account (with the unread
  count), personal-layer and notices stores. Both are unit-tested with fakes.
- `files.ts` (paths, folder listing, size checks, attachment paths) and `files-store.ts` (the
  Files screen's store, the upload loop the new chat shares), tested in `files.test.ts`; `search.ts`
  (query, highlight segments, grouping, transcript paging), tested in `search.test.ts`.
- `push.ts`: push notifications: this device's state and its words, the route a tapped push opens
  (`pushRoute`, also used by upstream's notification router), and the settings store, tested in
  `push.test.ts`. `push-device.web.ts` (Web Push: the service worker `public/jarvis3-push-sw.js`,
  which shows each push and opens its screen; its `targetFor` mirrors `noticeTarget` and the test
  checks that) and `push-device.native.ts` (APNs token through expo-notifications, no Expo push
  service: the instance sends to Apple itself); `push-device.ts` is the no-push fallback.
- `daemon-endpoint.ts`, `ws-hook.ts`, `download-hook.ts`, `device-token.ts`, `config.ts`, `steps.ts`,
  `nav.ts`: the pieces that upstream modules import. None of them pulls in native modules beyond
  `expo-constants`.
- `sidebar.tsx` (the shell), `composer.tsx` (the new chat's and a sleeping chat's composer, the
  surface of Paseo's), `keyboard-frame(.native).tsx` (the composer rides the keyboard on iOS),
  `chat-actions.tsx` (Rename and Delete dialogs), `device.ts`, `client.ts`, `hooks.ts`, `gate.tsx`,
  `ui.tsx`, `task-host.ts`, `index-route.tsx`, `screens/*`: the variant's runtime and screens.

### Hooks in upstream files

| File                                                | Hook                                                                                                                                                                                                                   | Why                                                                                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/app.config.js`                        | the `jarvis3` variant (name, bundle id, scheme, `extra.jarvis = {version: 3, url, scheme}`); the extra scheme, and no getpaseo EAS project/owner, when a variant has `jarvis`                                          | build switch; `JARVIS3_INSTANCE_URL`, `JARVIS3_BUNDLE_ID`, `JARVIS3_SCHEME`, `JARVIS3_APP_NAME` override the `example.org` placeholders for an iOS build                           |
| `packages/app/package.json`                         | `expo-secure-store`, `expo-web-browser`; scripts `build:web:jarvis3`, `test:e2e:jarvis3`                                                                                                                               | iOS pairing; build and e2e                                                                                                                                                         |
| `packages/app/.gitignore`                           | `dist-jarvis3/`, `e2e-artifacts/`                                                                                                                                                                                      | build output                                                                                                                                                                       |
| `src/app/index.tsx`                                 | `export default Jarvis3Index ?? Index`                                                                                                                                                                                 | open on a new chat                                                                                                                                                                 |
| `src/app/welcome.tsx`                               | `export default Jarvis3Welcome ?? WelcomeRoute`                                                                                                                                                                        | never show Paseo's pairing welcome                                                                                                                                                 |
| `src/app/_layout.tsx`                               | `Jarvis3Sidebar` in place of `LeftSidebar`; app chrome on the variant's routes (`useJarvis3Chrome`); no file-explorer host and no Paseo shortcuts in the variant; its detail routes registered with the push animation | the chat app's sidebar in Paseo's chrome (pinned / drawer with gestures)                                                                                                           |
| `src/components/message.tsx` (`ToolCall`)           | the label from `jarvis3StepLabel` (plain words), and details always inline                                                                                                                                             | step chips; no bottom sheet on phones                                                                                                                                              |
| `src/composer/input/input.tsx`                      | the attach menu is a popover in the variant                                                                                                                                                                            | no bottom sheet                                                                                                                                                                    |
| `src/runtime/host-runtime.ts` (`createDefaultDeps`) | `jarvis3DaemonUrl(endpoint) ?? buildDaemonWebSocketUrl(…)`                                                                                                                                                             | direct hosts have no path; a task host goes to its daemon proxy                                                                                                                    |
| `src/runtime/host-runtime.ts` (`runBoot`)           | `isJarvis3` added to the desktop-daemon check                                                                                                                                                                          | never auto-add a `localhost:6767` daemon as a host                                                                                                                                 |
| `src/utils/test-daemon-connection.ts`               | the same URL hook, for the probe                                                                                                                                                                                       | the probe that learns the serverId                                                                                                                                                 |
| `src/runtime/websocket-factory.ts` (native)         | `withJarvis3Headers(nativeWebSocketFactory)`                                                                                                                                                                           | the device token on the daemon socket (iOS)                                                                                                                                        |
| `src/stores/download-store.ts`                      | `jarvis3DownloadRequest(daemonProfile, token)?.url ?? buildDownloadUrl(…)`, and its headers for the native download                                                                                                    | a task host's daemon HTTP is reached through the instance's relay; iOS sends the device token                                                                                      |
| `src/push-notifications/index.native.ts`            | `if (isJarvis3) return` in `startPushNotifications`                                                                                                                                                                    | upstream registers an Expo push token with each daemon and asks for permission at launch; in this variant the instance pushes (`src/jarvis3/push.ts`) and there is no Expo project |
| `src/utils/notification-routing.ts`                 | `jarvis3PushRoute(data) ?? …` in `buildNotificationRoute`                                                                                                                                                              | a tapped Jarvis 3 push opens the notice's screen                                                                                                                                   |
| `src/composer/index.tsx`                            | `showAgentControls: mode.showAgentControls && !isJarvis3`                                                                                                                                                              | no model/mode/thinking pickers in the chat                                                                                                                                         |

Every hook is inert in other variants: `isJarvis3` is false, and no endpoint ends in `.jarvis3.invalid`.

## Build and test

```bash
npm ci && npm run build:app-deps
npm run typecheck --workspace=@getpaseo/app
cd packages/app
npx vitest run --project unit src/jarvis3                 # jarvis3 unit tests
npm run test                                              # the app's whole unit suite (upstream's too)
NODE_OPTIONS=--max-old-space-size=6144 npm run build:web:jarvis3   # web export -> dist-jarvis3/ (Metro needs > 2 GB)
npm --prefix ../.. run build:server                       # the e2e runs a real Paseo daemon
npm run test:e2e:jarvis3                                  # Playwright vs the mock instance
```

The e2e (`packages/app/e2e-jarvis3/`, outside `e2e/`, where upstream's CI contract wants only its
own browser suite) serves `dist-jarvis3` from a mock instance (`mock-instance.ts`) whose API has the
shapes of `api-types.ts`. Its daemon proxy (WebSocket and HTTP) reaches a real Paseo daemon (`daemon.ts`: dev supervisor,
mock provider, a daemon password, one seeded agent; new chats get a second daemon whose longer
mock stream reaches its tool calls). Identity is mocked with the cookie `CF_Authorization=<email>`.
`jarvis3.spec.ts` covers the chat app: it opens on an empty chat with the textbox focused; sending
creates the chat (the model picked in the composer), which shows in the sidebar at once; the answer's
step chips expand; Rename and Delete; a sleeping chat shows its history and wakes when you type
(`POST /messages`, no resume call); the sidebar reaches every screen (and on a phone through the
drawer); plus the personal layer's edit/Reset/Undo, Suggest for everyone, usage in the profile menu,
another user's chat (404, its socket, rename and HTTP relay refused), the admin users page from the
profile menu (hidden for staff; cap state, Tier 0 tools, a raised tools cap, an offboarded person's
archive and layer), and the notices count. `projects.spec.ts`: a person's Project (a repo and a
write-only secret that no response carries), the composer's Projects picker, a clash refused with the
key named, shared Projects read-only for staff and only for their roles, nobody seeing another's
private Project, an admin sharing one. Also approvals (`approvals.spec.ts`), and scheduled chats, channels and wakeups, "Wake this chat at…" included (`schedules.spec.ts`,
with the mock's schedules, cron preview and posts in `mock-schedules.ts`), and the Files screen,
the new chat with an upload and with files from Files, search and the transcript reader with their isolation
(`files-search.spec.ts`), and the push settings (`push.spec.ts`, mock push routes in `mock-push.ts`; the
browser's `PushManager` is stubbed, since a test browser has no push service, while the service
worker is the real one). It saves phone (390) and desktop (1440) screenshots in
light and dark to `JARVIS3_SCREENSHOT_DIR` (CI: the `jarvis3-screenshots` artifact).

Paseo's layout remounts the route when the window crosses its compact/desktop breakpoint, so
in-progress form input is lost on such a resize. The e2e re-enters it after its screenshots.

## Running the web app locally

**Against a real Jarvis 3 server.** The web app must be served from the instance's own origin: it
takes the instance URL from `location.origin` and relies on the Access cookie. So serve
`dist-jarvis3/` from the instance, the way the server image does. For UI work with live reload, put
both behind one origin. For example, run the server on `:8080` and Metro
(`APP_VARIANT=jarvis3 npx expo start --web --port 8081` in `packages/app`), with a reverse proxy
where `/api/*` (WebSockets included) goes to `:8080` and everything else to `:8081`. A local server
without Access needs whatever test-identity mode the server offers.

**Against the mock**, with no server:

```bash
cd packages/app
npm run build:web:jarvis3
node --import tsx e2e-jarvis3/mock-instance.ts --dist dist-jarvis3 --port 8090
# optional: --daemon ws://127.0.0.1:<port>/ws --daemon-password <pw> to chat with a local daemon
# open http://127.0.0.1:8090 and set the cookie CF_Authorization=alice@example.org (dev tools)
```

## Shipping the iOS app

`.github/workflows/jarvis3-ios.yml` runs on a push to `main` that touches the app (or by hand:
`gh workflow run jarvis3-ios.yml -R DE0CH/jarvis3-app`, inputs `upload` and `simulator`). Two jobs
run in parallel on GitHub `macos-26` runners, 40 to 60 min each:

- **simulator**: builds the app with `JARVIS3_INSTANCE_URL=http://localhost:8090`, starts the mock
  instance there, on the newest iOS runtime's iPhone 17, and Maestro (`packages/app/jarvis3-ios/maestro/`) walks the real pairing flow:
  Sign in, the system sign-in sheet, the mock's sign-in page (standing in for Cloudflare Access),
  the `jarvis3://paired` redirect, then the first screen: an empty chat with the composer (loaded
  with the device token); a first message opens the chat with "Starting…" and shows in the
  sidebar's drawer; a relaunch that stays paired, and the sidebar's Notices > Notification settings >
  Turn on > Allow (`push.yaml`); the log says whether iOS gave the simulator an APNs token (the mock
  logs each registration). Every step's screenshot is checked for a blank screen
  (`check-frames.py`: almost every pixel the background colour fails the run, even when Maestro found
  what it looked for), and the whole run is recorded (`run.mp4`). `prepare.sh` fails unless the
  generated entitlements ask for `aps-environment = production`. Screenshots go to the `jarvis3-ios-simulator` artifact; they hold mock data only.
- **testflight**: builds with the instance's URL, archives unsigned, then `-exportArchive` with
  `-allowProvisioningUpdates` and the App Store Connect API key signs the app with Apple's
  cloud-managed distribution certificate and uploads it (no certificates or profiles anywhere).
  `CFBundleVersion` is `<run number>.<attempt>`; the marketing version comes from
  `packages/app/package.json`. Before the upload a second export to an `.ipa` is checked for
  `aps-environment = production` (`check-push-entitlement.sh`): without it iOS gives the app no APNs
  token. The variant sets expo-notifications' `mode: "production"` in `app.config.js`.

The instance is never in git. Per build it comes from the repository's Actions settings:

| Name                                             | Kind     | What                                                                      |
| ------------------------------------------------ | -------- | ------------------------------------------------------------------------- |
| `JARVIS3_INSTANCE_URL`                           | secret   | the instance's `https://` origin (masked in the public logs)              |
| `JARVIS3_BUNDLE_ID`                              | variable | the app's bundle id on the Apple team                                     |
| `JARVIS3_APP_NAME`                               | variable | the home-screen name                                                      |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY` | secrets  | an App Store Connect API key with the Admin role (cloud signing needs it) |

The app's URL scheme must match the instance's `devices.appScheme` (`jarvis3` unless
`JARVIS3_SCHEME` says otherwise). One app record serves one instance: a second instance needs its
own bundle id, app record and set of these values (for example a GitHub environment per instance).

Before the first build, on the Apple team: register the bundle id with the Push Notifications
capability (the instance pushes through APNs, and `expo-notifications` adds the `aps-environment`
entitlement), make an APNs key for the team (the instance's `APNS_KEY_P8`; one key serves every app
of the team), create the App
Store Connect app record (no public API for that; App Store names are unique worldwide, so the
record name can differ from the home-screen name), and an internal TestFlight group with access to
all builds, so every processed build reaches its testers. `ITSAppUsesNonExemptEncryption=false` is
already in the Info.plist, so builds need no export-compliance answer.

Pitfalls:

- Keep the archive unsigned. A signed archive makes automatic signing mint a new Apple Development
  certificate on every fresh runner, and once the team reaches Apple's certificate limit the archive
  fails with "Choose a certificate to revoke". Revoking old ones is not a fix: a development-signed
  app installed from one of them stops launching.
- Ad-hoc sign the simulator build (`CODE_SIGN_IDENTITY=-`), never `CODE_SIGNING_ALLOWED=NO`. An
  unsigned app has no entitlements, so the simulator keychain refuses expo-secure-store's write of
  the device token ("A required entitlement isn't present") and pairing fails right after the mock
  sign-in, which looks like a flaky Maestro assertion.
- Boot the simulator at the start of the job (`simulator-test.sh --boot`). A fresh simulator's first
  boot takes 2-6 minutes of runner CPU; started right before Maestro, it starves Maestro's XCTest
  driver past its 5-minute start window ("iOS driver not ready in time").
- `APP_VARIANT=jarvis3` must be set for every step. Xcode's "Bundle React Native code" phase
  re-reads `app.config.js`; without it the app embeds upstream's config.
- The unsigned archive asks for no entitlements, and `-exportArchive` keeps only what the app asks
  for, so the TestFlight build had no `aps-environment` (iOS then gives it no APNs token). The job
  ad-hoc signs the archived app with its entitlements file before exporting; the export re-signs it
  with the distribution certificate and keeps the request. A simulator build's
  `codesign -d --entitlements` is empty whatever the app asks for (simulated entitlements live in
  the binary), so check the entitlements file there.
- Build with Xcode 26. An app linked against the iOS 27 SDK must adopt the UIScene life cycle, and
  Expo SDK 54's template doesn't.
- Expo names the Xcode project after the app name (`Jarvis 3` -> `Jarvis3`); `prepare.sh` writes it
  to `ios/.jarvis3-name` for the later steps.

## Staying on upstream

There is no automatic upstream update (Deyao, 2026-10-09). Bring in a newer upstream only when
it's wanted, and never by force-pushing:

On a new branch, `git fetch upstream && git merge upstream/main`, refresh the lockfile
(`npm install --package-lock-only --ignore-scripts`), run the checks, push the branch and open a PR. Upstream's Expo
SDK is never upgraded here; upgrades come only with upstream. A workflow upstream adds later
arrives enabled: disable it (`gh workflow disable … -R DE0CH/jarvis3-app`) unless it's wanted.

## API requests

Changes wanted on the server side are in `JARVIS3-API-REQUESTS.md`. This repo doesn't edit jarvis3.
