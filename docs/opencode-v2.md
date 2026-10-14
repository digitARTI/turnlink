# OpenCode V2 migration

Turnlink's OpenCode adapter is V2-only: minimum 2.0.28, major version 2. Its plugin dependency is pinned to 2.0.28. The broker protocol, protected credential files, message history and Codex/Claude adapters are unchanged. `src/migrate-v2.js` migrates Turnlink state; it is **not** an OpenCode migration command.

## Cutover

1. Save active work and back up the applicable OpenCode config. Stop using the old V1 adapter before switching; do not load two adapters for the same session.
2. Run `npm ci` using supported Node.js (>=22.22.2; Node 24 recommended).
3. Replace the selected Turnlink plugin entry with the native V2 directory form, preserving unrelated configuration:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [{
       "package": "file:///absolute/path/turnlink/adapters/opencode",
       "options": {
         "url": "ws://127.0.0.1:47321",
         "tokenFile": "/private/workstation.token",
         "credentialDirectory": "/private/turnlink-session-keys"
       }
     }]
   }
   ```

   OpenCode 2.0.28 rejects configured plugin file paths with “configured plugin path must be a directory”; the directory entrypoint is tested. Defaults and environment-based broker configuration still work when options are omitted. Keep credential paths private; never put raw credentials in config.

4. Reload the location, or deliberately restart the background service after saving work. Closing one terminal does not stop the service. Confirm plugin ID `turnlink` is active and all five tools appear.
5. Join from the actual recipient session and repeat the acceptance test below. Migration does not automatically adopt old V1 memberships: they were not recorded in V2 plugin storage. An explicit join resumes the same broker identity when permitted.

The macOS hardening cutover helper now accepts native V2 config only. It preserves other plugins, comments and existing options, and supports `--config <file>`, `--plugin <directory>` and `--plan-only`. Its state-directory argument still selects the **Turnlink hardening** destination and endpoint 47323. It does not migrate unrelated V1 configuration.

## Delivery and recovery

- Tools retain their names: `channel_join`, `channel_members`, `channel_send`, `channel_history`, `channel_leave`. OpenCode acknowledgements remain internal.
- Identity comes from tool execution, not model-supplied arguments. Session location is checked before tool use or admission.
- Each broker message gets one durable inbox admission with a stable `msg_turnlink_...` ID, provenance metadata and the existing untrusted-peer framing.
- Both idle and busy delivery use `session.prompt` with `delivery: "steer"`, `resume: true`. OpenCode owns scheduling; the adapter no longer guesses busy status or copies agent/model/tool restrictions from history. Steering cannot undo an executed tool.
- The private admission ledger is written before submission and before acknowledgement. A lost V2 response is retried with the same native ID. The broker acknowledgement means **durable harness acceptance**, not model processing or task completion.
- Old `inflight`/`uncertain` receipts without a V2 admission ID stay held for manual evidence-based reconciliation using `src/admissions.js`; they are not blindly retried.
- Non-secret membership/form metadata lives in plugin storage. Reload resumes existing claims with their protected proofs; expired/released claims are not recreated. Disconnects retain the broker's existing five-minute reservation.
- Permission requests are refreshed from the public plugin API. Running native `question` tools are detected from session context, including when their form-created event was missed.
- The 2.0.28 server plugin context does **not** expose the HTTP client's generic form-list API. Observed forms are tracked by events and persisted. If a form settlement is missed during a stream outage, its blocker remains **fail-closed**; generic external forms existing before observation cannot be reliably snapshotted by this plugin API. Do not treat a stream reconnect as proof that every form was answered.
- Event subscriptions are live-only and explicitly resubscribed after failure. Session deletion/moves detach the old receiver; `/new` does not transfer authorization or membership.

No exactly-once task-completion guarantee is introduced. Membership removal cannot undo work already admitted to OpenCode.

## Verification

```sh
npm run check
npm test
TURNLINK_OPENCODE_INTEGRATION=1 node --test test/opencode-service.test.js
```

The final command requires OpenCode on PATH (or `TURNLINK_OPENCODE_EXECUTABLE` pointing at it). It starts a foreground server with isolated HOME/XDG directories, a private temporary broker and a loopback deterministic model endpoint. It never uses the managed service, real user credentials, or a paid model. It validates native tool execution, Plan-agent preservation, idle wake, busy steering, native-ID retry, permissions/forms and reconnect.

Socket tests separately cover all tool definitions, leave/admission races, reload/replay, cross-location rejection, uncertain receipts, persisted form blockers and event-stream recovery. Windows-only cases still require Windows.

**Deployment/live-model acceptance remains separate:** join two real sessions, let the recipient go idle, send a task and verify its same-session reply. Repeat while busy, while awaiting approval/question, and across receiver reconnect. Confirm another session receives nothing. Initial OpenCode 1.18.35 and Turnlink v0.1 evidence is historical—not proof of this V2 adapter.
