# Opt-in contained OpenCode host

> **Historical experiment:** automatic live transfer and modified runtimes are not part of the supported workflow. The experimental code is retained on [`experimental/native-transfer`](https://github.com/digitARTI/turnlink/tree/experimental/native-transfer). Use [manual stop and resume](migration-resume.md).


`node src/opencode-contained-host.js --config /absolute/private/config.json`
starts the experimental host broker, authenticated verifier registry and
networkless container tunnels. Nothing is enabled by default. The config and
all referenced credential and environment files must be private regular files;
directories must be owned by the current user and mode 0700. The host,
administrator, completion, announcement, adapter, movement, source recovery
and takeover credentials must be distinct 64-character hexadecimal values.

The private config has this shape (replace all paths and identifiers):

```json
{
  "version": 1,
  "docker": "/opt/homebrew/bin/docker",
  "runtimeManifest": "/private/runtime/manifest.json",
  "owner": {
    "directory": "/private/state/owner",
    "spec": {
      "resourceID": "00000000-0000-4000-8000-000000000000",
      "image": "sha256:REPLACE_WITH_64_HEX_DIGEST",
      "command": ["-e", "setInterval(()=>{},1000)"],
      "mounts": [],
      "init": true,
      "volume": { "destination": "/var/lib/turnlink", "mode": "rw" },
      "tmpfs": ["/tmp", "/run/turnlink-secrets"]
    }
  },
  "broker": {
    "directory": "/private/state/broker",
    "endpointDirectory": "/private/state/endpoints",
    "verifierDirectory": "/private/state/verifiers",
    "port": 0,
    "hostTokenFile": "/private/secrets/host",
    "adminTokenFile": "/private/secrets/admin",
    "completionTokenFile": "/private/secrets/completion"
  },
  "announcement": {
    "secretFile": "/private/secrets/announcement",
    "brokerPort": 31683,
    "guestPort": 31681
  },
  "modelTunnel": { "hostPort": 31680, "guestPort": 31680 },
  "guest": {
    "mode": "takeover",
    "ownerFile": "/private/state/owner-request.json",
    "environmentFile": "/private/state/native-environment.json",
    "adapterTokenFile": "/private/secrets/adapter",
    "movementTokenFile": "/private/secrets/movement"
  },
  "recovery": {
    "takeoverGeneration": "00000000-0000-4000-8000-000000000001",
    "takeoverTokenFile": "/private/secrets/takeover",
    "sourceGeneration": "00000000-0000-4000-8000-000000000002",
    "sourceTokenFile": "/private/secrets/source",
    "prepareSuccessor": true
  }
}
```

`modelTunnel`, `guest`, and `recovery` are optional. The model tunnel reaches
only the configured host loopback port. A guest mode is `completion`,
`source-recovery`, or `takeover`. The private owner request contains the
existing owner configuration and exact grant; its database, source,
destination, credential directory and journal directories must be inside
`/var/lib/turnlink`. Runtime entrypoint, verifier and endpoint paths are set by
the host, not by the guest. The native environment file is a JSON object of
environment variables. In `OPENCODE_CONFIG_CONTENT`, exact string values
`__TURNLINK_HOST_TOKEN_FILE__`, `__TURNLINK_ADAPTER_TOKEN_FILE__`,
`__TURNLINK_MOVEMENT_TOKEN_FILE__`, `__TURNLINK_CREDENTIAL_DIRECTORY__` and
`__TURNLINK_BROKER_URL__` are replaced in the guest with its private paths and
loopback broker URL. Credentials are sent to the guest over the private Docker
stream and written into a fresh mode-0700 directory on tmpfs.

`prepareSuccessor` is available only for takeover mode. With the broker
directory lock held, it checks the durable draining binding against the owner
journal, stops and removes the exact old container, and creates a successor on
the same volume. An interrupted or ambiguous owner operation fails closed;
it is not blindly replayed. The broker and verifier recheck the binding before
rotating the receiver into held state. The guest journals the native claim
before dispatch and uses the persisted successor key to reconcile a lost
rotation reply. Source detachment, fresh native idle observation, placement,
completion verification and release remain separate steps.

The reusable local runtime must have an image digest and content digest in
the manifest, and the image label must match that content digest. Docker daemon
access remains a trust boundary: another client with the same daemon authority
can alter volume custody. Do not point this experimental path at irreplaceable
session data until the complete migration gate has been independently closed.

The runtime prepared for the isolated host tests has manifest
`.native-runtimes/turnlink-contained-54fa61263092/manifest.json` and local
image digest
`sha256:02b5dd9fb4f206440a488c86978870630a6713e2db971cc89dfe38b60de965a6`.
Its reproducible content digest is
`54fa612630928a1768bd234ca211fdfdfea19efb93885b045d5b13735ea485a7`.
It was assembled from the isolated application/runtime snapshot, not from a
signed release artifact. The CLI end-to-end test uses this image, a fixture
initial transition and a local mock model; it does not use an existing personal
OpenCode session.

## Experimental isolated plugin path

A separate capability bridge can run the Turnlink plugin in a networkless,
read-only container while the owner retains the broker socket and receiver
proof. The tested participant surface covers join, participant control,
peer delivery and session-scoped tool calls. Peer admission is checked and
journaled by the owner. Task execution, movement, and the production loader
are not yet connected to this bridge. Membership authorization in the
integration test is a fixture. The Docker daemon remains shared.

The local experimental bundle manifest is
`.native-runtimes/turnlink-plugin-sealed-edf817e50a9a-v2/manifest.json`. Its
image, bundle and guard hashes identify a local test artifact; selected
loader, native-addon, file and process bypass tests do not prove complete
runtime confinement. The guard requires Node 24.21.0. The observer checks the
image, running process, command, mounts, and bundle hashes twice and returns
`executionEligible: false`; it cannot authorize a move. It is a frozen test
snapshot tied to the application image below, not a signed release.

An OpenCode preview may bind an explicitly unverified plugin provenance
observation. Its digest is retained in the grant and movement journal, but
the broker refuses receiver offers and movement authorization for that grant.
It is evidence for further verification, not an executable capability.

The native live descriptor also has an experimental idle-family hold and a
transfer to quarantine under the same reservation. The private descriptor
alone is not broker authorization. Binding a verified provenance and fresh
broker grant to this transfer remains unfinished; no production path uses it.
An opt-in synthetic DeepSeek test holds the real plugin capability host idle
at the same time as the native session-family reservation, for longer than
two maintenance intervals. The owner requests a typed maintenance pause,
drains outstanding capability work before taking the activity hold, and
resumes maintenance only after releasing it. A real tool attempt invalidates
the hold. The test's private control socket does not attest or maintain a
production lease.

`node src/opencode-source-host.js --config /absolute/private/config.json`
is a separate opt-in startup for a new source runtime. The private config
specifies `version`, absolute `runtime`, `entrypoint`, `database`, `source`
directory, `sessionID`, `environment`, and `endpointFile`; endpoint
credentials are written only to the newly created private file. Its native
descriptor is delegated to the source owner with only idle observation and
hold/check/release operations; attempts to prepare or move fail closed.
Configure the native loader explicitly to use `adapters/opencode-isolated.js`
with a fixed session, channel, credentials, socket and sealed manifest. It
is not enabled by the normal destination CLI.

The owner bridge keeps broker credentials and journals in the source process,
enforces its configured channel and binds an authenticated authority watch to
the held reservation. Its RPC hashes two matching native observations of the
selected agent and model, effective permission inputs, tool and hook identity,
and instructions, while checking native revisions and input freshness. The
result is non-executable: full executable origins, destination authority and
daemon custody are unresolved. The DeepSeek source test exercises this opt-in
CLI and adapter with synthetic data.

The experimental Unix daemon relay accepts a supervisor-owned upstream stream
and closes its local connections on revocation or socket replacement. It has
been exercised with the shared daemon. A VM-backed Docker API upstream and
exclusive daemon custody are not yet established; the relay provides the full
daemon API to processes able to connect and is not a same-UID boundary.

A separate destination fixture runs the native observer in a networkless,
read-only container with a read-only project, an ephemeral state filesystem,
and no user credentials. Observation mode refuses configured external plugin
imports and MCP connections before their effects. The fixture obtained a native
graph digest under hold and rejected an instruction-file change; it also proved
that synthetic plugin and MCP writes did not run. Since rejected plugins are
absent from that graph, it is not the real destination's complete authority,
is not bound to its eventual owner, and cannot authorize a grant.

The experimental sealed-plugin launcher pins the Docker client and seal
observer to the same Unix socket and verifies its device and inode throughout
inspection. The observer checks the daemon ID before and after inspection and
rejects a provenance binding with a different ID. These checks do not establish
exclusive custody of the daemon or socket. The current quiescence test image
is `.native-runtimes/turnlink-plugin-quiescence-v2/manifest.json`; like the
earlier bundle it is a local unsigned test artifact and is not execution
authority.
The updated local application snapshot is
`.native-runtimes/turnlink-contained-c2ac60317813/manifest.json`; it contains
the native descriptor change. Its 434-file overlay was measured before and
after the build and checked against the resulting image. The CLI takeover and
second-task fixture passed with this image; the real-source grant path remains
unverified.
