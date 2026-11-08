# Review-only system supervisor

This source builds a system Mach-service supervisor that **never dispatches a
VM or Docker effect**. The system build exposes `status` and `revoke`, rejects
VM start and pause, and cannot unfence. The UID, state and fence directories,
Mach service, peer signing identifier and Apple team are compiled in. It refuses
root or a different effective UID, opens directory path
components without following symlinks, checks ancestor ownership, mode and
ACL, requires a private owner-controlled state directory, and retains an
exclusive advisory lock. Revocation writes and fully synchronizes a pending
marker before rename and synchronizes the containing directory. A separate
fixed directory holds an independent `authority.fence` record which is created
and synchronized before any XPC connection is accepted. It is always closed:
no unfencing or grant acceptance is implemented. Distinct directory inodes are
required, but they may share a filesystem and storage failure domain.

The system build constructs the XPC peer requirement from the compiled-in
identifier and ten-character Apple team ID with `anchor apple generic`; the
same-UID fixture uses an ad-hoc identifier only. Team membership is not an
authorization decision by itself: the exact requirement and client signing
identity must be reviewed and tested on the deployment host. The review-only
`review-client.m` pins an Apple anchor, team and service identifier on its XPC
connection before activation and exposes only status and historical revocation
observation. It does not authenticate a grant, enable a VM, or authorize an
effect. The ad-hoc fixture accepts its own service identifier and rejects a
wrong identifier from the client side; a missing pinned system service also
fails closed. Ad-hoc identity and a missing-service test do not establish
production service authenticity. The current fixture uses an
application-embedded XPC service rather than an installed system daemon; it
does not verify the system Mach namespace, two UID isolation, provisioning,
VM access, code-signing identity, power-loss durability, or I/O reconciliation.
The lock is advisory and works only if no untrusted process can replace or
modify its inode or journal. In particular, the fixture's same UID can do so;
its relaxed ancestor checks apply only when `TURNLINK_VM_FIXTURE=1`. Different
UID and privileged process threats require actual host tests. No signed
release or production approval is implied by successful compilation.

The read-only `observeRevocation` operation reports `recorded` only for a
valid local completed marker; a pending, malformed or replaced marker is
`uncertain`, and an absent marker is `no-local-marker`. These are historical
observations of the local journal only: an absent marker does not establish that
no revocation or external effect occurred, and no result opens the fence or
proves that a guest or daemon has stopped. Same-UID writers remain outside this
observation's exclusion boundary.

The opt-in macOS fixture also characterizes client identity: an ad-hoc signed,
unhardened client executed an injected `DYLD_INSERT_LIBRARIES` library while
the XPC request succeeded. Re-signing that fixture with hardened runtime blocked
that particular injection and still allowed status, but another process with the
same UID could execute the genuine hardened client with its `revoke` argument.
This is one fixture on one host; neither hardening nor a pinned executable hash
authorizes the request or excludes all process attacks. A real service must
validate each grant and request, protect its state under a separate identity,
and test its actual hardened signing and deployment configuration. The sandboxed
keychain check returned no identities, while a later read-only check outside the
sandbox found one Apple Development identity. Its suitability, entitlement and
private-key access have not been verified, and it has not been used for this
supervisor.
In a separate broker fixture a second process of the same UID read temporary
0600 host and adapter credentials, used the saved receiver key after the original
receiver disconnected, and observed the exact held grant. This did not replace
an active receiver. Matching a grant and proving possession of same-UID files
therefore does not by itself distinguish the intended process.

If a revocation write fails before any marker exists, the running process faults
closed; after restart the separate authority record remains closed. A test also
crashes during an unsynchronized partial marker. This is process-crash evidence,
not proof of power-loss durability or independence from a shared disk failure.
There is no durable authorization or recovery mechanism to open the fence.

For an actual review build substitute a **verified free** role UID, an
authorized client identifier and real Apple team. This is an example only:

```sh
clang -fobjc-arc -fblocks -framework Foundation -DTURNLINK_VM_FIXTURE=0 \
  '-DTURNLINK_VM_STATE_DIR="/private/var/turnlink-vm-proof/private"' \
  '-DTURNLINK_VM_FENCE_DIR="/private/var/turnlink-vm-proof/fence"' \
  -DTURNLINK_VM_EXPECTED_UID=480 \
  '-DTURNLINK_VM_PEER_IDENTIFIER="org.turnlink.example.client"' \
  '-DTURNLINK_VM_PEER_TEAM="ABCDE12345"' \
  '-DTURNLINK_VM_SERVICE_NAME="org.turnlink.vm-proof"' \
  native/codex-vm-supervisor/supervisor.m -o turnlink-vm-supervisor
```

A separate review-only client can be built with fixed, reviewed service
identity values (the sample values are placeholders):

```sh
clang -fobjc-arc -fblocks -framework Foundation \
  '-DTURNLINK_VM_SERVICE_NAME="org.turnlink.vm-proof"' \
  '-DTURNLINK_VM_SERVICE_IDENTIFIER="org.turnlink.example.supervisor"' \
  '-DTURNLINK_VM_SERVICE_TEAM="ABCDE12345"' \
  native/codex-vm-supervisor/review-client.m -o turnlink-vm-review-client
```

Values `480`, `org.turnlink.example.client` and `ABCDE12345` are placeholders,
not verified account, signing or authorization settings. `launchd.example.plist`
is a template, not installed configuration. A temporary unsigned review binary
is not a release artifact and must not be deployed. Prepare and verify a real
signed executable, the exact service/client identities, and user/group and
private directories using the separate account procedure before any installation.

After those prerequisites and a separate review, these are the concrete
**not executed** installation commands for the sample names. First check each
target is absent, every ancestor is trusted and the exact files match the
approved digests. They require root and would modify the system:

```sh
sudo /usr/bin/install -d -o root -g wheel -m 0755 /private/var/turnlink-vm-proof/bin
sudo /usr/bin/install -o root -g wheel -m 0755 ./turnlink-vm-supervisor /private/var/turnlink-vm-proof/bin/turnlink-vm-supervisor
sudo /usr/bin/install -o root -g wheel -m 0644 ./launchd.example.plist /Library/LaunchDaemons/org.turnlink.vm-proof.plist
sudo /bin/launchctl bootstrap system /Library/LaunchDaemons/org.turnlink.vm-proof.plist
```

Do not execute `install` over an existing target: it overwrites files. The
commands intentionally do not create the account or private state and separate
fence directories;
see [the account procedure](../../docs/codex-dedicated-vm-account-procedure.md).
They also do not supply, sign or enable a production client. Installing a
system job does not close the gate.

Before activation verify owner/group/ACL of all parents and installed files,
compiled UID/team/identifier/service against actual signed identities, binary
signature and digest, the plist with `plutil -lint`, absence of conflicting Mach
services and account identity, and effective process identity after launch.
Test unauthorized users, forged/shared connections, inherited descriptors,
process crash and lock handoff, journal write errors, reboot and storage
recovery, revocation racing every effect, and actual VM/daemon confinement.
Retain quarantine if any observation is unknown or fails; no effect interface
currently exists. The fixture is run with
`TURNLINK_VM_XPC_PROBE=1 node --test test/codex-vm-system-supervisor.test.js`
and may require running outside the filesystem sandbox on macOS. Set
`TURNLINK_VM_CONTROL_PROBE=1` and supply the explicitly SHA-256-pinned initramfs
through `TURNLINK_DOCKER_VM_INITRD` and `TURNLINK_DOCKER_VM_INITRD_SHA256` to
exercise the fixture-only VM start and pause callbacks. The VM has no guest disk,
network interface or shared host directory. These callbacks do not establish
guest readiness or drain pending guest I/O; production VM control remains blocked.

For an additional disposable-daemon test, set `TURNLINK_VM_DAEMON_PROBE=1`
instead of `TURNLINK_VM_CONTROL_PROBE`, and supply the 32-byte fixture key as
`TURNLINK_DOCKER_VM_KEY` along with the matching initramfs and its SHA-256.
The test creates its own sparse disk, boots a guest-local daemon, verifies an
HMAC-authenticated ping and response, checks an explicit wrong-key rejection,
requests revocation, and crashes the XPC supervisor after the guest's durable
acknowledgement. A successor restarts the same disk, authenticates a read-only
container inspection, and observes that the revoked relay denies ping. The host
fence remains closed throughout. This mode offers only ping, inspection and
revocation to the host; it does not dispatch a container effect.

The broker/VM integration fixture stops its guest explicitly and waits for its
own XPC service PID to exit before deleting the disposable disk. If that stop
or exit cannot be confirmed, it retains the fixture directory. This cleanup
protocol exists only in the fixture; it does not control a system service.

That HMAC test authenticates both directions of each connection under the
fixture's shared key and fresh guest nonce. The key is present in the temporary
initramfs and readable by the same host UID; it is not an isolation boundary
against that UID. A supplied initramfs hash checks equality with the supplied
hash, not artifact provenance; the locally sourced libraries remain unverified.
The crash point is after acknowledgement, not every possible point during the
guest's persistence or host/guest I/O. The guest and host records can share a
physical failure domain. A same-UID attacker, privileged process or compromised
guest is not excluded by this experiment. VM control and guest relay access in
the system build remain blocked pending a real service and credentials.

## Experimental broker observations

`broker-verifier-service.m` is a separate review build with a fixed service
name, dedicated non-root UID, protected state directory, and pinned client
signing requirement. It queries a fixed, pinned broker-verifier service for
an exact grant digest, transition, effect, resource and operation, correlating
replies with a fresh nonce. The query is a point-in-time observation. The
production review build explicitly refuses retained subscriptions: the
current broker does not expose the required protected Mach service, and the
query has no durable revocation channel. Neither a successful query nor the
service enables VM/effect dispatch.

`broker-lease-client.m` retains an XPC connection and invalidates an
observation on a matching revocation notification or connection failure. Its
only working server is an ad-hoc-signed test fixture. An end-to-end test joins
that fixture through a disposable Unix socket to the actual broker's v2
process-local guard. It observes three concurrent requests and confirms that
adapter revocation or broker SIGKILL invalidates all three. The XPC client and
fixture service check each other's ad-hoc identifiers; **the Unix bridge and
its broker state are still same-UID and are not authenticated isolation**.
Socket notification delivery is asynchronous and does not establish atomic
revocation against an external effect. No resulting observation authorizes an
effect, release or unfencing. Production needs a protected broker authority,
mutually authenticated channel, retained revocation semantics and a two-UID
test before a real lease can be trusted.

A read-only review build (placeholders, never installed) can be compiled with:

```sh
clang -fobjc-arc -fblocks -framework Foundation -DTURNLINK_BROKER_VERIFIER_FIXTURE=0 \\
  '-DTURNLINK_BROKER_VERIFIER_SERVICE="org.turnlink.broker"' \\
  '-DTURNLINK_BROKER_VERIFIER_IDENTIFIER="org.turnlink.broker"' \\
  '-DTURNLINK_BROKER_VERIFIER_TEAM="ABCDE12345"' \\
  '-DTURNLINK_GRANT_SERVICE_NAME="org.turnlink.verifier-proof"' -DTURNLINK_GRANT_EXPECTED_UID=480 \\
  '-DTURNLINK_GRANT_CLIENT_IDENTIFIER="org.turnlink.supervisor"' \\
  '-DTURNLINK_GRANT_CLIENT_TEAM="ABCDE12345"' \\
  '-DTURNLINK_GRANT_STATE_DIR="/private/var/turnlink-vm-proof/verifier"' \\
  native/codex-vm-supervisor/broker-verifier-service.m \\
  native/codex-vm-supervisor/broker-verifier-client.m -o turnlink-broker-verifier
```

`480`, the team and identifiers must be replaced with verified values. This
build remains disabled for effects and must not be installed as a trusted
service based on the fixture result.

`launchd.grant-verifier.example.plist` is a disabled template for the same
review build. It is not installed. The verifier state directory must be a
new 0700 directory owned by the dedicated UID under the reviewed service
root; all ancestors must pass the service's root ownership and ACL checks.
Run the account preflight for `org.turnlink.verifier-proof` as well as the VM
service label and verify both names and plist paths are absent. The current
implementation refuses lease subscriptions even with an otherwise valid
signature; its broker endpoint and protected broker-side authority do not yet
exist. A disabled plist or a successful signature check does not establish
that authority or permit provisioning.

### Protected broker review package

`package/build-review.mjs` builds an offline Node single-executable review
artifact. Run it from the repository root with a clean environment and
absolute paths to the previously provisioned Node, esbuild and postject
executables. The output directory must not already exist. For example, replace
each placeholder before running:

```sh
env -i PATH=/usr/bin:/bin HOME=/var/empty LANG=C /absolute/node \
  native/codex-vm-supervisor/package/build-review.mjs \
  --out /private/tmp/new-broker-review --node /absolute/node \
  --esbuild /absolute/esbuild --postject /absolute/postject \
  --uid 480 --root /private/var/turnlink-vm-proof/private --fixture 0
```

The manifest records the input graph, tool and dependency hashes, bundle, blob
and executable hashes. Independent builds with identical inputs on the same
host have produced identical artifacts. The signature is ad hoc and the
manifest always reports `productionReady: false`. It does not authenticate
the inputs or protect them from concurrent modification. A later Apple-signed
artifact needs its own post-signing hash and identity/entitlement checks;
signing may itself change the bytes. The Node entitlements include JIT and
unsigned executable memory and require explicit security review.

The candidate launchd hierarchy uses the native bridge as the launchd main
process and spawns the broker through an anonymous socketpair. A temporary
user-domain fixture exercised the real broker grant, revocation and child
crash; it used ad-hoc identity and one UID. The opposite hierarchy did not
deliver Mach service requests in repeated local tests. The review bridge checks
the broker path, hash, signature and runtime before spawning with a constructed
environment and only fd 3. The disabled
`launchd.protected-bridge.example.plist` is a configuration example only.

Direct invocation of the Node executable can process `NODE_OPTIONS` before its
application-level UID check. A same-UID caller is therefore not excluded by
the executable itself. A malicious preload did not propagate through the
controlled native spawn in the fixture, but no two-UID account, protected
store, credential access or Apple-signed production identity has been tested.
The non-fixture build fails closed when invoked under the current user. Effects
remain disabled; the remote activity inventory and migration binding are not
complete.

An additional experimental MCP attempt channel passes a private descriptor to
the native process and requires a broker-owner acknowledgement before each
transport attempt. The owner binds records to the parsed grant digest and
syncs the record and directory before acknowledging; a closed, revoked or
invalid channel refuses further sends. Recovery reports those records as
uncertain and the inventory as partial, including after reconnection. The
current test owner and inherited descriptor are same-UID fixtures. They do
not establish that the production supervisor created the process, that the
process cannot bypass the journal, or that all remote activity is covered.
The channel does not authorize effects or release. A production binding needs
the verified two-UID supervisor to create the process and its descriptor,
hold the actual broker lease, and enforce the scope for the entire process
lifetime. The native channel is currently compiled only in debug builds;
other builds reject its opt-in instead of silently bypassing it.

The same-UID supervisor fixture also starts a real app-server after the real
broker binds the grant. An MCP call is recorded before sending; adapter
revocation invalidates the observation and prevents a second send. A separate
native crash test retains an uncertain record without replay. Neither proves
that the system service can launch Codex under the intended distinct user.
A bridge already running as the dedicated unprivileged UID cannot switch to a
different UID by itself. A reviewed privileged launcher or an authenticated
launchd-mediated handoff must create the two endpoints under their intended
identities, preserve descriptor provenance and verify the process identity;
it must be tested before enabling that path.

`fetch-linux-arm64-review.sh` prepares a separate Cargo cache with network
access and the checked-in lockfile; `build-linux-arm64-review.sh` then runs
offline, with the source and V8 files read-only, using a fixed ARM64 Rust image
digest and dedicated target directory. The V8 manifest and both artifacts are
checked against the pinned source. The build uses no user home or credential
mounts. These are review scripts: input provenance and a second independent
build must be checked before claiming bit-for-bit reproducibility.
An optional `TURNLINK_LINUX_TARGET_VOLUME` selects an already-created,
build-UID-writable Docker volume for `/target`; its contents remain in that
volume. On this host the bind-mounted target rounded fingerprint timestamps and
caused unnecessary rebuilds. Two identical small builds on a disposable Linux
volume instead showed all dependencies fresh on the second build. A full
app-server build on that volume has not yet been performed.
