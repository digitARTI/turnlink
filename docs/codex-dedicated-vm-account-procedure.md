# Proposed dedicated VM supervisor account (not applied)

This is a provisioning and verification procedure for a **new test-only** macOS
role account. Nothing here authorizes modifying an existing account, changing
Docker Desktop permissions, moving user data, or enabling the production
retirement path. Review the exact values and executable before execution. If any
precondition fails, stop; do not overwrite an existing account, group, path, or
launchd service. A separate account alone is not proof of Gate 2 isolation.

## Preflight (read-only)

1. Choose a new role name such as `_turnlinkvm`, a new group name such as
   `_turnlinkvm`, an unused UID in 450–499, an unused GID, and an unused launchd
   label such as `org.turnlink.vm-proof`. The local `sysadminctl -h` states that
   role names start with `_` and role UIDs must be 450–499. Check the full local
   records and active directory sources, not just users with login shells:

   ```sh
   dscl . -list /Users UniqueID
   dscl . -list /Groups PrimaryGroupID
   dscl /Search -list /Users UniqueID
   dscl /Search -list /Groups PrimaryGroupID
   launchctl print system/org.turnlink.vm-proof
   ls -ldeO /private /private/var
   ls -ldeO /private/var/turnlink-vm-proof
   ```

  A read-only, executable preflight is available (the values are examples,
  not a reservation):

  ```sh
  node src/codex-vm-provision-dry-run.js --role _turnlinkvm --group _turnlinkvm \
    --uid 480 --gid 480 --label org.turnlink.vm-proof
  ```

  It does not call sudo, write files, create an account or install a service.
  It reports collisions or unknown results from the local and search directory
  nodes, the proposed service and paths, and whether the current keychain shows
  any signing identities. An optional `--supervisor /absolute/path` checks only
  that `codesign --verify --strict` accepts a file. To review actual candidate
  binaries, provide all four additional arguments:

  ```sh
  node src/codex-vm-provision-dry-run.js --role _turnlinkvm --group _turnlinkvm \
    --uid 480 --gid 480 --label org.turnlink.vm-proof \
    --supervisor /absolute/path/to/reviewed-supervisor --client /absolute/path/to/reviewed-client \
    --team ABCDE12345 --client-identifier org.turnlink.client \
    --supervisor-identifier org.turnlink.supervisor
  ```

  The team and identifiers above are placeholders. This invokes `codesign`
  with an exact Apple anchor, team and identifier requirement for each file,
  checks their hardened runtime flags, and reads the supervisor's Virtualization
  entitlement. Failures and inaccessible signatures remain unknown or rejected;
  a match does not authorize a request, verify current execution, prove service
  identity to a client, or exclude same-UID invocation or injection. Never use
  ad-hoc signatures as the real identity. `readyToInstall` is always false while the
  supervisor has no production VM/effect implementation. Sandboxed directory or
  keychain access can produce unknown or incomplete results. On this host the
  sandboxed keychain check showed zero identities while a read-only check
  outside the sandbox showed one Apple Development identity; its suitability,
  key access and entitlement are unverified. Repeat all checks with appropriate
  read access immediately before provisioning.

   The last two target checks should report that the proposed label and path
   are absent. Inspect ancestor ownership, symlinks and ACLs; stop if another
   untrusted user can replace an ancestor. Directory lookups can fail under the
   sandbox: obtain an authorized read-only result rather than assume absence.
   Repeat uniqueness checks immediately before account creation; they are not
   atomic against another administrator concurrently provisioning accounts.
2. Prepare a signed, reviewed **test** supervisor binary outside all existing
   user-owned directories. The current Swift controller and hard-coded test
   harness are not a launchd supervisor or an authenticated service, so they
   must not be installed as one. Decide how clients authenticate each request;
   same-UID possession of a file or a PID check is insufficient. The local XPC
   manual recommends peer code-signing requirements validated for incoming
   messages; verify API availability and test connection sharing for the target
   macOS version. Do not distribute a guest key to ordinary clients.

## Proposed privileged changes

These are **not executed**. Each step needs an administrator/root authorization;
record the exact created identifiers and outcomes. Let `UID_CHOSEN` and
`GID_CHOSEN` denote the independently checked numeric values and substitute them
explicitly. The examples use a new group rather than adding the account to an
existing one. `dscl` record creation is multi-step, not transactional: if a
step fails, stop and inspect the partial record; never silently overwrite or
remove it.

1. Create only the new group (root):

   ```sh
   sudo dscl . -create /Groups/_turnlinkvm
   sudo dscl . -create /Groups/_turnlinkvm PrimaryGroupID GID_CHOSEN
   ```

2. Create the role account (administrator authorization). `sysadminctl -h`
   supports `-roleAccount`, `-UID`, `-GID`, `-shell`, `-home` and password
   prompting with `-`; confirm its behavior on this macOS release before use.
   Use the interactive prompt; never put an administrator password in argv,
   shell history or a file. This example sets a non-interactive shell and does
   not grant admin membership:

   ```sh
   sudo sysadminctl -addUser _turnlinkvm -roleAccount \
     -UID UID_CHOSEN -GID GID_CHOSEN -shell /usr/bin/false \
     -home /var/empty -password - -adminUser ADMIN_NAME -adminPassword -
   ```

   A false shell alone does not prove all login services are disabled. Inspect
   the resulting account, authentication policy and group memberships. If the
   OS requires a different provisioning method, stop and review it; do not
   repurpose `vncuser` or modify an existing user.
3. Create a new root-controlled service root and a separate private state
   directory (root), only after confirming the full target is absent:

   ```sh
   sudo /usr/bin/install -d -o root -g wheel -m 0755 /private/var/turnlink-vm-proof
   sudo /usr/bin/install -d -o _turnlinkvm -g _turnlinkvm -m 0700 /private/var/turnlink-vm-proof/private
   sudo /usr/bin/install -d -o _turnlinkvm -g _turnlinkvm -m 0700 /private/var/turnlink-vm-proof/fence
   ```

   Inspect `ls -ldeO` and `stat` afterward, including ACLs and all ancestors.
   Do not chmod, chown, clear ACLs on, or copy data from existing user or Docker
   directories. Stage verified executable and initramfs under root-controlled,
   non-writable paths; keep the journal, secret and disposable disk in the
   dedicated account's private directory and the separate fail-closed authority
   record in the fence directory. These directories can share a storage failure
   domain. Root can still access them.
4. Only after the supervisor and its authenticated control protocol exist, an
   administrator may install a reviewed root-owned plist in `/Library/LaunchDaemons`
   and `launchctl bootstrap system <exact-new-plist>`. The plist must use
   `UserName=_turnlinkvm`, the dedicated `GroupName`, a root-owned absolute
   `ProgramArguments` path, and a restrictive umask. `UserName` is meaningful
   in the privileged system domain; merely using `launchctl asuser` does not
   change the process UID. Do not set `RunAtLoad` or automatic restart until
   the durable recovery and fencing behavior has been validated. Installing or
   bootstrapping a system service requires root and is deliberately not done
   by this procedure.

## Verification before any production use

* Read back account UID, GID, groups, shell and authentication policy. Verify
  the actual supervisor PID's effective UID and groups, executable signature,
  root-owned executable and plist, and resolved paths. Inspect ACLs and every
  ancestor. `launchctl print` is diagnostic output, not a stable API.
* Under the normal user **and** another nonprivileged account, attempt to read
  the test secret and journal, open the test disk for writing, replace the
  executable or socket, connect directly to the guest daemon, and pass or
  inherit a previously opened descriptor. All unauthorized attempts must
  fail; include actual Desktop and competing writers. Never probe by writing
  user data or existing Docker state. Check XPC peer requirements continuously,
  including a connection-shared client. Access by root or privileged debuggers
  is outside this boundary and must be explicitly accounted for.
* Verify the dedicated UID can launch the signed VM controller with the needed
  virtualization entitlement on the actual host; account separation does not
  establish that Virtualization.framework permits this. Run the full real-daemon
  pause, pending-revocation crash, in-flight I/O, restart and reconciliation
  tests under that account with independent test data. Ensure a durable host
  revocation record fences restart and all ambiguous accepted effects remain
  quarantined; do not infer guest I/O completion from a pause acknowledgment.
* Preserve a record of every new object. Any later cleanup must first stop and
  verify the exact test service and processes, then separately review removal
  of only the objects created for this test. Never recursively remove a path
  merely because its name matches the proposal.

### Executable two-UID probe (not executed)

After creating the reviewed disposable account and private directory, stage a
reviewed copy of `src/codex-vm-uid-probe.js` under the root-owned service `bin`
directory and record its digest. Use only two new, empty, regular fixture files
named `probe.key` and `probe.disk` inside the new private directory. Create them
as the dedicated UID with exclusive creation (`O_CREAT|O_EXCL`), mode 0600, no
ACLs or hard links; never use actual keys, databases or virtual disks. If either
name exists, stop rather than overwrite it. Record the created device/inode and
verify ownership and ACLs before the test. Ensure the reviewed Node executable
and staged script are traversable by both test users.

Then run the reviewed script as the dedicated UID and separately as the ordinary
user (these examples are **not executed**; substitute the verified UID and
reviewed absolute Node/script paths):

```sh
sudo -u _turnlinkvm /absolute/path/to/node /absolute/path/to/codex-vm-uid-probe.js --uid 480 --role owner
/absolute/path/to/node /absolute/path/to/codex-vm-uid-probe.js --uid 480 --role outsider
```

The owner must report both opens allowed and the outsider must report both
denied with `matchesExpected: true`; an absent file or other error is `unknown`,
not proof of denial. The script opens the fixture key read-only and fixture disk
write-only without reading, writing, creating or truncating either. The owner
test establishes that both fixture files exist and are usable; the outsider test
must follow while their recorded identities remain unchanged. These checks do
not cover ACL races, inherited file descriptors, other paths, process injection,
root, Desktop or a competing writer. Run the additional checks listed above.
An actual different-UID test has not been run: non-root `setuid(65534)` returned
`EPERM`, and noninteractive sudo required a password on this host.

### Rollback of a reviewed disposable installation (not executed)

Rollback is manual and applies only to objects recorded as created for this
test. First stop accepting requests; boot out the exact recorded service label,
confirm the service and every process under the recorded UID have exited, and
retain any uncertain effect or revocation journal for inspection. Compare the
recorded device/inode, owner, mode and digest of the plist and executable before
removing either; stop on any mismatch. Remove each disposable probe file only
after matching its recorded identity; do not remove the journal or virtual disk
without separate evidence that no recovery or user data remains. `rmdir` may be
used only on the exact newly created directories after they are empty; never use
recursive deletion. After verifying the role name and numeric UID still match the
recorded newly created account and it owns no required data, an administrator can
remove that single directory-service record with `dscl . -delete /Users/_turnlinkvm`.
Only after confirming no other user or process depends on the recorded new group
may its single group record be removed with `dscl . -delete /Groups/_turnlinkvm`.
These are privileged, nontransactional changes; a changed identity, path, active
process or uncertain effect stops rollback for manual review.

## Local XPC fixture

`test/codex-vm-xpc-fixture.test.js` builds an ad-hoc-signed temporary application
with an embedded XPC service. It tests a code-signing identifier requirement on
each accepted connection, a different identifier being rejected, a missing
directory failing closed, and a service crash after syncing the pending marker
but before renaming it. A later service connection sees the pending marker and
reports a fence; attempting another revoke at that point reports an error and
keeps the marker. Run with `TURNLINK_VM_XPC_PROBE=1 node --test
test/codex-vm-xpc-fixture.test.js`; on the test host the sandbox could not launch
the embedded service, and the run passed outside it. It creates no account or
installed launchd job and provides no Docker or VM operation.

This is a protocol fixture, not the dedicated supervisor. The marker directory
is supplied by the client, the test identity is an easily forged ad-hoc signing
identifier, and the journal belongs to the caller's UID. The embedded service
can be instantiated separately for different client processes, so its in-process
lock is not a global owner lease. `fsync` plus a process crash does not establish
power-loss durability. A production design still needs a system service with a
single authoritative owner, a private fixed journal path, a strong validated
peer requirement for every message, secure key delivery and exclusive VM/daemon
access, alongside the tests above. No fixture result authorizes dispatch.

On the tested macOS 26.6.2 host, calling
`setConnectionCodeSigningRequirement:` on the embedded service listener caused
the service to crash inside the platform XPC library. The fixture instead sets
`setCodeSigningRequirement:` on each accepted connection before activation; this
observation should be rechecked on supported OS versions rather than generalized.
