# Passive OpenCode CLI alerts

This experimental V2 integration shows coordination hints in the **human terminal
UI**, not in the model inbox. It never starts/steers a turn, answers a permission
or form, accepts a task, renews a lease or executes recovery. Both sides default
off. Existing session identity, agent/model, instructions and permissions stay
native and unchanged.

## Explicit opt-in on both sides

Enable `control: true` and `alerts: true` in the existing Turnlink **server** plugin
entry in the applicable `opencode.json(c)`. Preserve other plugin entries/options:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "file:///absolute/path/turnlink/adapters/opencode",
    "options": {
      "url": "ws://127.0.0.1:47321",
      "tokenFile": "/private/workstation.token",
      "credentialDirectory": "/private/turnlink-session-keys",
      "control": true,
      "alerts": true
    }
  }]
}
```

The broker must have the experimental control plane enabled. No adapter/admin
credential or task/effect opt-in is needed for alert reads. Join explicitly from
the real session as usual; the alert reader never joins, subscribes or adopts a
different session for you.

Also enable the CLI entry in the existing **global** `cli.json` at
`~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`), merging
with its existing plugins/settings:

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [{
    "package": "file:///absolute/path/turnlink/adapters/opencode",
    "options": { "alerts": true }
  }]
}
```

The package exports `./tui`. In tested OpenCode 2.0.28, automatic discovery of
that entry does not carry the server's alert opt-in into `context.options`; the
CLI-owned option is explicit and separate. **Do not copy token paths or broker
credentials into CLI options.** The CLI calls the connected OpenCode server's
read-only custom RPC, not the broker itself. Against a remote OpenCode server,
the server plugin must be installed there and the CLI entry available locally.
Nothing here configures, restarts or stops an existing production service.

## Behavior and scope

- Only the currently viewed session in its exact native Location is polled.
  Home/plugin pages and sessions without matching cached native location data do
  not trigger broker reads. Native session movement detaches as before.
- `control_alerts` authenticates the actual enrolled member/session proof and
  returns typed metadata only: aggregate storage pressure, open channel incident
  count, your uncertain/overdue tasks, your pending reports, evidence-backed work
  awaiting your verified master review, and a pending role proposal for you.
  Optional absence of a master is not itself an alarm.
- No task/message/instruction bodies, session titles, provider responses,
  credentials, authentication headers, artifact contents or filesystem paths enter
  the alert payload. Storage details remain operator-only; the pressure summary
  uses the same visibility boundary as `control_info`.
- Polling is bounded to once per 15 seconds per active CLI scope, with a shared
  15-second server-side session cache. Late responses are discarded after a move,
  membership generation/channel change, view switch, cancellation or unload.
  Broker scheduling quarantine does not suppress a readable warning snapshot;
  inaccessible state is unknown/unavailable, never reported as healthy.
- Changed issues show a local toast. Identical hints are deduplicated in bounded
  per-TUI memory (32 recent scopes), which survives plugin reload but not terminal
  exit. A resolved issue can notify again on recurrence. This is not a durable
  alert acknowledgement, incident resolution or background delivery guarantee.
- Run `/turnlink-alerts` or the palette's **Show Turnlink alerts** to inspect a
  local dialog. Neither path submits a model command or changes session selection.

For optional OS attention, set `alertNotifications: true` **in the CLI plugin
options**. It requests only a generic, content-free notification when the terminal
is blurred, with no sound request. OpenCode's native attention preferences and OS
permissions remain authoritative. OS notification delivery failures never cause a
model wake or automatic retry of work.

Alerts and zero counts are observations, not admission, stop or completion proof.
Review artifact/stop evidence and the participant report before explicit master
acceptance. A role proposal still needs explicit acceptance, and no alert adds
tools or weakens harness approvals.

## Verification

```sh
node --test test/opencode-alerts.test.js
TURNLINK_OPENCODE_INTEGRATION=1 node --test test/opencode-service.test.js
# Opt-in actual POSIX terminal fixture (requires Python 3 and OpenCode):
TURNLINK_OPENCODE_TUI_INTEGRATION=1 node --test test/opencode-tui-service.test.js
```

The unit/process tests check member/proof/channel isolation, metadata redaction,
scope/ABA/cancellation fences, deduplication, bounded memory, explicit options and
no prompt/permission/actor calls. The real server fixture exercises the registered
RPC with the deterministic local model. The separate POSIX pseudo-terminal fixture
starts a private `--standalone` CLI with isolated HOME/XDG, observes its actual
toast API, and checks that alert refresh does not wake the model. Terminal bytes
stay in a private temporary file and are never uploaded to test output. The fixture
does not send approval replies or terminal commands. No production service, real
user credentials or paid provider is used.

Windows, IDE presentation, native OS notification delivery and live-model
deployment acceptance remain separate operational gates.
