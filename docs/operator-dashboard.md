# Operator dashboard (experimental)

The React/Mantine console is a **human-only, loopback-only** surface over the
existing broker. It does not activate tasks, managed movement or recovery
executors. Production configuration and harness permissions stay unchanged.

## Run in isolated state

Use the project's supported Node version (Node 24 is used for the fixtures).
Install/build the separate frontend once:

```sh
npm --prefix dashboard ci
npm run dashboard:build
```

Start an experimental control-enabled broker in a private test state directory,
then configure the channels with the operator CLI. In another terminal using the
**same** `AGENT_CHANNEL_STATE_DIR`/broker URL:

```sh
TURNLINK_DASHBOARD_CHANNELS=development npm run dashboard
```

Open `http://127.0.0.1:47322` directly. The startup message identifies the private
`dashboard-login.token` file in the broker state directory. Read it locally and
enter that separate dashboard login. **Never enter the broker host/admin token.**
The login file is generated with private permissions and is not printed in logs
or placed in URLs. Stop the console and rotate this file to revoke its login
credential; stopping/restarting invalidates all browser sessions/previews.

`TURNLINK_DASHBOARD_CHANNELS` is a required comma-separated allowlist (at most 16
existing channels, no spaces). `TURNLINK_DASHBOARD_PORT` optionally changes the
HTTP port. The listener always binds `127.0.0.1`, and Host/Origin checks use that
exact address/port, not arbitrary hostnames, forwarded headers or proxy URLs.
The dashboard does not configure a broker, enroll hosts/adapters, change tokens,
or silently create an unconfigured channel. It requires a built `dist/dashboard/`;
no Vite development proxy or browser-to-broker WebSocket access is used.

## Implemented console

- Channel participants, actual advertised execution flags, recovery mode and
  current master/proposal. Roles remain supplemental, not security privileges.
- Bounded task, incident, action, evidence, audit-event and activity pages.
  Task report/artifact/stop references stay distinct from master acceptance.
- Private message inspection only after a deliberate load; broker inspection
  audit remains authoritative. Peer text is escaped, not executed as HTML or
  interpreted as operator instructions. No external assets/content are loaded.
- Storage pressure, quotas, unresolved-work counts via the API, and telemetry
  coverage/loss visibility. Visible views refresh every 15 seconds; errors are
  shown rather than represented as healthy or silently retried mutations.
- Read-only command-receipt lookup, including after a lost dashboard response.
  A found receipt means a broker command was recorded, not that a native effect
  completed; absence never grants retry/reassignment authority.
- Preview/confirm for channel policy/election enablement, volunteer master
  appointment/revocation, supported pending recovery approval/rejection, existing-
  cwd task creation and explicit missed-schedule run-late/skip decisions.

Participants still claim, vote, report and accept/review in their own harnesses.
The console cannot act as a participant/master/adapter, submit native evidence,
accept a task on a master's behalf, start an uncertain replay, approve managed
movement or change native agent/model/cwd/permissions. Unsupported or disabled
executors cannot be approved through this surface. A recorded broker command
does **not** independently prove a native effect or task completion.

## Authentication and command boundary

The backend alone holds the admin credential. The browser receives only an opaque
host-only `HttpOnly; SameSite=Strict` session cookie, an in-memory CSRF token and
allowlisted collaboration data. There is one active operator session: a new login
revokes the old one. Sessions have request-based 30-minute idle and 8-hour absolute
expiry. Polling is activity, but never extends the absolute expiry. Credentials,
cookie values and command bodies are not logged or persisted by the dashboard.

API calls require a custom same-origin request header; all POSTs additionally
require the exact Origin, and authenticated POSTs require the session CSRF token.
Host, Fetch Metadata, request/body/preview budgets, strict schemas, no CORS, CSP,
frame denial, no-store responses, no-referrer and a small static asset allowlist
limit the browser surface. Authentication errors never include parser/provider/
filesystem exception bodies. The HTTP cookie intentionally has no `Secure` flag
on this strictly local HTTP listener. **This is not a remotely deployable HTTPS
authentication solution.** Do not expose it on LAN, use an unreviewed reverse
proxy, or treat same-user filesystem/browser compromise as sandboxed.

Every mutation uses an explicit UUID command and a session-bound two-minute
preview. Confirmation shows the current authoritative mode/master generation,
affected recovery proposal (if any) and exact immutable command. The server checks
the session after asynchronous reads and again immediately before the actual RPC
send, including after reconnect. A replacement login/logout cannot leave a queued
old-session command authorized to send later. Logout does not undo commands already
sent/committed or cancel authorized native work.

Policy revision, master/proposal/election identity and volunteer inventory are
also checked **inside the broker's command transaction**, not just by a preceding
dashboard read. A changed precondition rejects without applying/receipting the new
command. Exact previously committed command IDs still return their original durable
receipt; conditions do not erase idempotency history. Caller-supplied conditions
are operator-only checks, never identity, scheduler or adapter authority.

Concurrent confirmation is held; completed confirmations return the cached result.
An uncertain command response is not resent, controls are disabled in that browser
view, and the exact UUID is shown for operator receipt investigation. Previews/cache
are bounded and process-local, not a substitute for broker receipts. After a lost
response or dashboard restart, inspect the original command ID before manually
submitting another operation. No browser mutation is automatically retried.

Use **Check receipt** in an uncertain-outcome alert, or inspect from the operator
host without submitting the command again:

```sh
npm run control-admin -- receipt development ORIGINAL_COMMAND_UUID
```

The lookup is operator-only and channel-scoped, stays available with readable
control storage even when scheduling is quarantined, and returns bounded event-ID
metadata/digest rather than private command fingerprints or command bodies.
`known: false` is not proof that a delayed command cannot still arrive; a found
receipt likewise does not prove native stop/completion. Neither result automatically
clears uncertainty or re-enables mutations in that browser view.

## Verification and remaining gates

```sh
npm run test:dashboard
npm run dashboard:build
# Install the test browser once if needed:
npm --prefix dashboard exec -- playwright install chromium
npm --prefix dashboard run test:e2e
```

Backend regressions cover authentication, CSRF/Host/Origin/Fetch Metadata, session
replacement/logout races, expiry, scope/schema/body/rate budgets, commit conditions,
disabled effects and uncertain responses. Browser fixtures run the built UI against
a real isolated broker on desktop/light and mobile/dark Chromium, switch themes,
run axe checks on exercised views/dialogs, verify escaped peer content, cancellation,
voluntary task boundaries, stale previews and held uncertain HTTP outcomes. They
also discard an actual committed command's HTTP reply and recover its receipt
without creating a second task or inferring task execution/completion. They
use no real credentials, production state or paid model requests. Screenshots and
failure traces are generated under ignored `dist/dashboard-evidence/`.

This is not full platform acceptance. Safe storage reclamation, comprehensive
adapter health, OpenCode-native alerts, managed worktree continuity/creation/cleanup,
remaining adapter-backed recovery effects, actual Windows/IDE and live-model
deployment evidence remain separate gates. Dashboard notifications/acknowledgement,
advanced dependency/schedule editors and broader operator workflows are still
incomplete. Storage alerts here are an in-page polling view, not a guaranteed
background notification service.
