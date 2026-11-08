# Codex Desktop state isolation

The installed Codex Desktop 0.135 runtime is incompatible with the writer lock
used by the supported standalone runtime. Its embedded executable is preserved
as `codex.turnlink-unisolated-0.135.0-alpha.1`; the original `codex` launch path
is replaced by `codex-desktop-isolated-wrapper.sh`.

The wrapper always uses:

`$HOME/Library/Application Support/Turnlink/CodexDesktopHome`

It deliberately overrides inherited `CODEX_HOME` and `CODEX_SQLITE_HOME`, so the launched runtime does not select the
standalone runtime's default thread store through these environment variables.
This environment override does not supersede a native `sqlite_home` setting or
managed requirement; the effective SQLite location must be verified separately.
The verifier also starts the preserved app-server under a temporary home, runs
a complete synthetic-model turn through the installed wrapper, and checks that
its rollout and SQLite state are in the isolated home while the inherited shared
home remains unchanged. A shared-home instruction trap also stays out of the
synthetic model request. This exercises the runtime, not every Desktop process
or managed-configuration path. Full Desktop and managed-configuration isolation has not yet been verified. An
app update that replaces the wrapper causes the standalone verifier to fail; it
is not currently wired into the production Gate 2 preflight.

Inspection of the installed Desktop application bundle found that the Desktop
process itself resolves `CODEX_HOME` independently and can create its own SQLite
database under that home. The app-server wrapper cannot set the parent process's
environment. Consequently, the wrapper alone does not isolate the entire app;
a verified application-level launch boundary and coverage of existing instances
are still needed. The verifier checks that the current Desktop and standalone
store paths resolve to distinct, non-nested directories, but that point-in-time
check does not exclude later changes or other writers.

`node deploy/launch-isolated-codex-desktop.js` is a separate application-level
launcher. It starts a new app instance with `CODEX_HOME` and `CODEX_SQLITE_HOME`
set to the isolated runtime home and `CODEX_ELECTRON_USER_DATA_PATH` set to a
separate profile, and passes the same profile via Chromium's early
`--user-data-dir` option, so the installed Electron app's single-instance lock does not
intentionally reuse the normal profile. It checks those directories against the
default and explicitly configured standalone homes before launch. A temporary
macOS app verified that Launch Services passes all three variables to the
application process. The real Desktop executable was also started directly in a
temporary macOS sandbox with IP networking and normal-home reads denied. It
created its Electron profile and application SQLite database under the isolated
paths, leaving the synthetic shared-home trap unchanged. That is a startup test,
not a full user session or a test of the real app via Launch Services. Finder,
Dock, an existing instance, or a
different launcher can still use the normal profile and shared home. Do not
treat this launcher as exclusive-writer evidence or Gate 2 authorization.

An additional opt-in real-application test now completes a Desktop chat turn
against a loopback mock model in a disposable home and profile. It checks the
Desktop application database, native session SQLite and rollout in the isolated
home, and checks that a shared-home instruction trap neither changes nor reaches
the mock model. The test denies reads from the actual home and external IP
connections with an outer macOS sandbox. Chromium uses `--no-sandbox` only
inside that inherited test sandbox because a nested sandbox cannot start there.
This runs the application executable directly; it is not evidence for Launch
Services, production renderer sandboxing, all managed configuration paths, or
exclusion of existing and differently launched writers.

Run it with `TURNLINK_DESKTOP_REAL_TURN_INTEGRATION=1 node --test test/codex-desktop-application-native.test.js`
on macOS with the installed Desktop app and the dashboard Playwright dependency.

Expected preserved-runtime SHA-256:

`c2663b1f51185720f97842e5a966c35b4ce23c7aeaa8654c13e0b6cf2230b878`

Rollback is explicit: stop Codex Desktop, remove the wrapper, and rename the
preserved executable back to `codex`. Rolling back also reopens Gate 2 until the
incompatible runtime is upgraded or isolated by another verified mechanism.

The Unix Codex proxy has an optional, default-off **candidate metadata check**
for a proposed separately owned store. On macOS, setting
`AGENT_CHANNEL_CODEX_STORE_CANDIDATE_DESKTOP_UID` to a positive decimal UID
makes proxy startup require explicit existing `CODEX_HOME` and
`CODEX_SQLITE_HOME` directories owned by the proxy's non-root real/effective
UID, with no group/other permissions. It checks every ancestor's owner, mode
and ACL and refuses symlinks, unknown ACL output and writable non-sticky
ancestors. Root- or owner-owned sticky ancestors are permitted. The declared
Desktop UID must differ from the proxy UID. An invalid or unsupported check
stops startup before the native child is launched; it does not create accounts,
change file permissions or migrate session data.

This screens current filesystem metadata only. The supplied UID is not a
verified identity of any Desktop process; the check does not prevent future
permission/path changes, already-open descriptors, same-UID writers, privileged
writers or alternate store paths. It is not an exclusion lock, does not enable
movement, and is not evidence to close Gate 2. Running the current proxy and
Desktop under the same UID necessarily fails this optional check.

The checked SQLite directory is the `CODEX_SQLITE_HOME` environment value, not
necessarily the directory Codex will actually use. Native configuration's
`sqlite_home`, including a managed requirement, takes precedence over that
environment value. An explicit `log_dir` can also place SQLite logs elsewhere.
The proxy check does not resolve or bind those native settings and therefore
does not verify the effective SQLite or log stores. A successful check is only
evidence about the two supplied paths and the declared UID.

The staged, patched Codex runtime additionally recognizes the two expected
path variables passed by the opt-in proxy. During native configuration it
compares resolved Codex, SQLite and SQLite log directories with those expected
paths, including after managed requirements have been applied; the patched
app-server treats failures as strict configuration errors. A local native test
verified refusal of conflicting user and managed settings before SQLite opened.
Stock Codex binaries may ignore the variables, and the proxy does not verify the
binary's identity. The same point-in-time policy also checks direct
`StateRuntime::init` and `SqliteConfig` pool creation before opening a database;
it refuses an outside path and an existing database symlink or hardlink. Some
callers can create a directory before asking the pool to open. It does not cover
SQLite opened by other code before configuration, a replaced path after the
check, SQLite sidecar aliases or other processes. It remains disabled by default
and does not establish writer isolation or authorize a transition.
