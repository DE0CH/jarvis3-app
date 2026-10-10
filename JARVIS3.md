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

| Screen                   | Route               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tasks                    | `/tasks`            | The user's own tasks (`GET /api/tasks`): title and state; **Start** for a paused task (`POST …/resume`), Pause, Delete (a centered confirmation dialog). Refreshes every 3 s while a task changes state. Below them, **This month**: the user's own model-spend limit, machine time, and (when the instance has Tier 0 tools) web search/fetch spend and proxy GB against their caps, from `GET /api/me`.                                                                                                                                                                                                        |
| New task                 | `/tasks/new`        | The first message and a model from the instance's curated list (`GET /api/models`); `POST /api/tasks` with a `requestId`, so a double press makes one task. **Attach files** (when `me.features.files`): each picked file is uploaded to `attachments/<requestId>/<name>` in the user's files first, then its path goes in `attachments`; a retry skips what is already up.                                                                                                                                                                                                                                      |
| Files                    | `/files`            | The user's files (`GET /api/users/me/files`), when `me.features.files` is on: folders implied by paths (`?dir=`, breadcrumb), size, date, "Saved by a task"; Upload into the open folder, Download (a short-lived link, `?link=1`, opened in a new tab or the browser), Rename/move (a path with folders), Delete (centered dialog); usage against the quota. An admin opens a person's files read-only with `?user=<id>` (from the Users page).                                                                                                                                                                 |
| Search                   | `/search`           | Transcript search over the user's own tasks (`GET /api/search`), archived ones too, when `me.features.search` is on: hits grouped by task with the matched words highlighted; admins can switch to everyone's tasks (`all=1`).                                                                                                                                                                                                                                                                                                                                                                                   |
| Transcript               | `/search/:id`       | A task's indexed conversation around a hit (`GET /api/tasks/:id/transcript?around=&agentId=`), opened scrolled to the hit, with earlier/later pages; **Open chat** when the task isn't archived.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Task                     | `/tasks/:id`        | Paseo's own chat panel (`AgentConversationPanel`) for the task's agent, on the task's host, without the workspace chrome. Before that: Starting…, Paused (with Start), Connecting…, or "doesn't exist, or isn't yours" for a 404.                                                                                                                                                                                                                                                                                                                                                                                |
| My instructions & skills | `/me/layer`         | The personal layer: instructions, skills (SKILL.md editor), notes; delete; **Reset to company default** (centered dialog) with **Undo**. Every change says it applies from the next task. When `me.features.suggestions` is on, **Suggest for everyone** on a skill, the instructions or a note opens a pull request on the org-env repo; the list shows each one's link and state.                                                                                                                                                                                                                              |
| Notices                  | `/notices`          | The instance's notices (a cap or the budget paused a task, a task failed, access removed), newest first; opening the screen marks them read. The navigation shows the unread count (`unreadNotices` in `GET /api/me`, refreshed every minute).                                                                                                                                                                                                                                                                                                                                                                   |
| Schedules                | `/scheduled`        | Scheduled tasks (`GET /api/schedules`; shown when `me.features.schedules`): each one's repeat in words, time zone, next run and last run's outcome; an On/Off switch and **Run now**. **New schedule** / a schedule's page (`/scheduled/new`, `/scheduled/:id`): title, prompt, model, Repeat (every day / weekday / week / month / hour, or a cron expression), time, time zone (the device's by default; the schedule keeps it), with the next five runs from `POST /api/schedules/preview`; Save, Run now, Delete (centered dialog) and the run history with links to the tasks.                              |
| Channel                  | `/channels/:taskId` | A task's channel: the posts its agent made (`jarvis_post`), newest first, rendered as markdown; opening it marks them read. Its wakeups: what each waits for, in words, its state, and **Cancel** (centered dialog). Reached from the task list ("N new posts" / Channel), the task chat's one-line summary (posts and the next wakeup), and a `channel_post` notice.                                                                                                                                                                                                                                            |
| Users (admins only)      | `/admin/users`      | Each user's monthly model-spend and machine-hour limits and use, with "At cap" when the machine-hour cap is reached; when the instance has Tier 0 tools, also web-tools spend and proxy GB with "Tools at cap", and a card with the providers and everyone's totals against the instance cap (`GET /api/admin/tools`); set or clear a per-user override (`PATCH /api/users/:id/limits`, the tools fields only when the instance has them). **Tasks & layer** shows a person's tasks (archive download for archived ones) and personal layer, kept after offboarding. Everyone's suggestions with link and state. |

Hidden in this variant: everything of Paseo's host model. The app opens on `/tasks`, never on the
welcome/pairing screen, and never auto-adds a `localhost:6767` daemon. Task routes don't mount
Paseo's sidebar (no manual pairing, QR, host settings or daemon pairing). The chat is the bare
conversation panel: no git/review panels, terminal, file explorer or workspace header, and no
model/mode pickers in the composer. The model is picked from the curated list at New task.

UI rules: Paseo's own components and theme (Button, SettingsCard/Row/Section/Select/Input,
SettingsTextAreaCard, ScrollView); questions are a centered `Modal` dialog, never
`alert()`/`confirm()` and never a bottom sheet; notices are inline banners.

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
  because a resumed daemon keeps its id. The task list removes the hosts of deleted tasks.
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
- `plan.ts`: pure decisions (task states and actions, the chat screen's phase, the task's agent,
  error messages and sign-out reasons, pairing redirect, skill validation, limit input, the
  notices label).
- `schedules.ts`: scheduled tasks, wakeups and channels: the schedule form's logic (repeat <-> cron,
  checks, the request), run/wakeup labels, notice targets, and the schedules and channel/wakeup
  stores (unit-tested in `schedules.test.ts`). Upstream Paseo owns `/schedules` (its own host
  schedules), so the variant's page is `/scheduled`.
- `api.ts`: the API client (fetch, base URL and credentials injected; the device's zone goes out as
  `X-Time-Zone` on every call; file uploads send the raw bytes). `stores.ts`: the tasks,
  account (with the unread count), personal-layer and notices stores. Both are unit-tested with fakes.
- `files.ts` (paths, folder listing, size checks, attachment paths) and `files-store.ts` (the
  Files screen's store, the upload loop New task shares), tested in `files.test.ts`; `search.ts`
  (query, highlight segments, grouping, transcript paging), tested in `search.test.ts`.
- `daemon-endpoint.ts`, `ws-hook.ts`, `download-hook.ts`, `device-token.ts`, `config.ts`: the
  pieces that upstream modules import. None of them pulls in native modules beyond `expo-constants`.
- `device.ts`, `client.ts`, `hooks.ts`, `gate.tsx`, `ui.tsx`, `task-host.ts`, `index-route.tsx`,
  `screens/*`: the variant's runtime and screens.

### Hooks in upstream files

| File                                                | Hook                                                                                                                                                                          | Why                                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app/app.config.js`                        | the `jarvis3` variant (name, bundle id, scheme, `extra.jarvis = {version: 3, url, scheme}`); the extra scheme, and no getpaseo EAS project/owner, when a variant has `jarvis` | build switch; `JARVIS3_INSTANCE_URL`, `JARVIS3_BUNDLE_ID`, `JARVIS3_SCHEME`, `JARVIS3_APP_NAME` override the `example.org` placeholders for an iOS build |
| `packages/app/package.json`                         | `expo-secure-store`, `expo-web-browser`; scripts `build:web:jarvis3`, `test:e2e:jarvis3`                                                                                      | iOS pairing; build and e2e                                                                                                                               |
| `packages/app/.gitignore`                           | `dist-jarvis3/`, `e2e-artifacts/`                                                                                                                                             | build output                                                                                                                                             |
| `src/app/index.tsx`                                 | `export default Jarvis3Index ?? Index`                                                                                                                                        | open on the task list                                                                                                                                    |
| `src/app/welcome.tsx`                               | `export default Jarvis3Index ?? WelcomeRoute`                                                                                                                                 | never show Paseo's pairing welcome                                                                                                                       |
| `src/runtime/host-runtime.ts` (`createDefaultDeps`) | `jarvis3DaemonUrl(endpoint) ?? buildDaemonWebSocketUrl(…)`                                                                                                                    | direct hosts have no path; a task host goes to its daemon proxy                                                                                          |
| `src/runtime/host-runtime.ts` (`runBoot`)           | `isJarvis3` added to the desktop-daemon check                                                                                                                                 | never auto-add a `localhost:6767` daemon as a host                                                                                                       |
| `src/utils/test-daemon-connection.ts`               | the same URL hook, for the probe                                                                                                                                              | the probe that learns the serverId                                                                                                                       |
| `src/runtime/websocket-factory.ts` (native)         | `withJarvis3Headers(nativeWebSocketFactory)`                                                                                                                                  | the device token on the daemon socket (iOS)                                                                                                              |
| `src/stores/download-store.ts`                      | `jarvis3DownloadRequest(daemonProfile, token)?.url ?? buildDownloadUrl(…)`, and its headers for the native download                                                           | a task host's daemon HTTP is reached through the instance's relay; iOS sends the device token                                                            |
| `src/composer/index.tsx`                            | `showAgentControls: mode.showAgentControls && !isJarvis3`                                                                                                                     | no model/mode/thinking pickers in the chat                                                                                                               |

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
mock provider, a daemon password, one seeded agent). Identity is mocked with the cookie
`CF_Authorization=<email>`. It covers the list, New task, opening the chat and sending a message,
Start for a paused task, the personal layer's edit/Reset/Undo, another user's task (404, and its
socket and HTTP relay are refused), the notices screen with the unread count, the HTTP relay to
the daemon, Suggest for everyone, the user's own usage this month, and the admin users page (cap state, Tier 0 tools use, the instance's tools totals and a raised tools cap, an offboarded person's archive and layer),
approvals (`approvals.spec.ts`), and scheduled tasks, channels and wakeups (`schedules.spec.ts`,
with the mock's schedules, cron preview and posts in `mock-schedules.ts`), and the Files screen,
New task with an attachment, search and the transcript reader with their isolation
(`files-search.spec.ts`). It saves phone (390) and desktop (1440) screenshots in
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
  instance there, and Maestro (`packages/app/jarvis3-ios/maestro/`) walks the real pairing flow:
  Sign in, the system sign-in sheet, the mock's sign-in page (standing in for Cloudflare Access),
  the `jarvis3://paired` redirect, the task list loaded with the device token, and a relaunch that
  stays paired. Screenshots go to the `jarvis3-ios-simulator` artifact; they hold mock data only.
- **testflight**: builds with the instance's URL, archives unsigned, then `-exportArchive` with
  `-allowProvisioningUpdates` and the App Store Connect API key signs the app with Apple's
  cloud-managed distribution certificate and uploads it (no certificates or profiles anywhere).
  `CFBundleVersion` is `<run number>.<attempt>`; the marketing version comes from
  `packages/app/package.json`.

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
capability (upstream's `expo-notifications` adds the `aps-environment` entitlement), create the App
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
