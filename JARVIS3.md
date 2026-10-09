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
  tests, a web build of the variant and its Playwright e2e; no signing, no TestFlight).
  Upstream's own workflows are disabled in this repo: they deploy, release or need
  getpaseo's secrets, and their full CI is too heavy for a private repo's minutes.

## What the variant is

| Screen                   | Route          | What it does                                                                                                                                                                                                                      |
| ------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tasks                    | `/tasks`       | The user's own tasks (`GET /api/tasks`): title and state; **Start** for a paused task (`POST …/resume`), Pause, Delete (a centered confirmation dialog). Refreshes every 3 s while a task changes state.                          |
| New task                 | `/tasks/new`   | The first message and a model from the instance's curated list (`GET /api/models`); `POST /api/tasks` with a `requestId`, so a double press makes one task.                                                                       |
| Task                     | `/tasks/:id`   | Paseo's own chat panel (`AgentConversationPanel`) for the task's agent, on the task's host, without the workspace chrome. Before that: Starting…, Paused (with Start), Connecting…, or "doesn't exist, or isn't yours" for a 404. |
| My instructions & skills | `/me/layer`    | The personal layer: instructions, skills (SKILL.md editor), notes; delete; **Reset to company default** (centered dialog) with **Undo**. Every change says it applies from the next task.                                         |
| Users (admins only)      | `/admin/users` | Each user's monthly model-spend and machine-hour limits and use; set or clear a per-user override (`PATCH /api/users/:id/limits`).                                                                                                |

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
  (Cloudflare propagation), and the app retries during that window. A later refusal means the
  device was revoked, so the app forgets the token. A CI simulator run can pass a token as the
  launch arguments `-jarvis3E2EClientId … -jarvis3E2EClientSecret …`.

## Code

- `api-types.ts`: vendored from jarvis3 (type-only). Refresh it with `scripts/jarvis3-sync-api-types.sh`.
- `plan.ts`: pure decisions (task states and actions, the chat screen's phase, which agent is the
  task's, error messages, pairing redirect, skill validation, limit input).
- `api.ts`: the API client (fetch, base URL and credentials injected). `stores.ts`: the tasks,
  account and personal-layer stores. Both are unit-tested with fakes.
- `daemon-endpoint.ts`, `ws-hook.ts`, `device-token.ts`, `config.ts`: the pieces that upstream
  modules import. None of them pulls in native modules beyond `expo-constants`.
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
shapes of `api-types.ts`. Its daemon proxy reaches a real Paseo daemon (`daemon.ts`: dev supervisor,
mock provider, a daemon password, one seeded agent). Identity is mocked with the cookie
`CF_Authorization=<email>`. It covers the list, New task, opening the chat and sending a message,
Start for a paused task, the personal layer's edit/Reset/Undo, another user's task (404, and its
socket is refused), and the admin users page. It saves phone (390) and desktop (1440) screenshots in
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

## Staying on upstream

There is no automatic upstream update (Deyao, 2026-10-09). Bring in a newer upstream only when
it's wanted, and never by force-pushing:

On a new branch, `git fetch upstream && git merge upstream/main`, refresh the lockfile
(`npm install --package-lock-only --ignore-scripts`), run the checks, push the branch and open a PR. Upstream's Expo
SDK is never upgraded here; upgrades come only with upstream. A workflow upstream adds later
arrives enabled: disable it (`gh workflow disable … -R DE0CH/jarvis3-app`) unless it's wanted.

## API requests

Changes wanted on the server side are in `JARVIS3-API-REQUESTS.md`. This repo doesn't edit jarvis3.
