# Disposable Docker VM experiment

> **Historical experiment:** automatic live transfer and modified runtimes are not part of the supported workflow. The experimental code is retained on [`experimental/native-transfer`](https://github.com/digitARTI/turnlink/tree/experimental/native-transfer). Use [manual stop and resume](migration-resume.md).


This is a test fixture, not an enabled production isolation boundary. The host
controller launches a disposable ARM64 VM with no network interface or shared
host directory. The guest runs a Docker daemon on a guest-local Unix socket and
persists its state on a disposable disk. The host uses a challenge-response
vsock relay. The secret is readable by the same host UID that runs the test;
the disk is writable by that UID. Authentication against a wrong key therefore
does not establish exclusion of other processes running as the same user.

`test/codex-dedicated-docker-vm.test.js` exercises a durable pending revocation
record and kills the controller before its rename. After reconstruction the
guest denies a new create. It also reproduces a revocation race, tests a
pre-dispatch recheck, and compares pause followed by destruction with a
guest-synchronized create. The pending marker is a test crash point, not a
proof for every power-loss or storage failure. The pause callback does not
guarantee that guest disk I/O was drained. In an observed run Docker returned
201 before pause, but the reconstructed daemon had no container and the
concurrent file was missing; a control that called guest sync retained its
container. These are individual observations, not latency or durability bounds.

A host-side durable revocation intent synchronized before any VM command could
preserve ordering across a host process crash, provided recovery holds the fence
and never resumes the old guest before reconciliation. It would not make an
already accepted request durable, drain guest I/O, or isolate a journal that the
same host UID can modify. Confirming a revocation must not be treated as proof
that external effects have finished.

The opt-in test requires an independently prepared ARM64 initramfs and key. Its
guest init, relay and controller sources are in `test/fixtures/`; the image must
also contain Docker, containerd, their dependencies and the pre-existing Alpine
fixture image. The relay key must be random and private to the disposable test;
never commit it or the initramfs containing it. An expected initramfs SHA-256 is
mandatory, but only verifies identity against the supplied value, not provenance.
The original run used verified Docker Debian ARM64 package digests below; its
glibc dependencies were extracted from a locally cached image and were **not**
independently verified. This is not a release-ready or fully reproducible build.

* docker-ce 29.9.3-1~debian.12~bookworm: `8fff6ababa422c4a35562817c109a4b1a71870e9572f82fd9283a69df23f35e9`
* containerd.io 2.4.2-3~debian.12~bookworm: `218982eddd9be6b97c3c80db2e2c3b8ab1269b741818c43896d8fd71e69531d9`
* docker-ce-cli 29.9.3-1~debian.12~bookworm: `50c7e64dec8530341f9137613e4b8127c5269f3d45219dcf1a197cd8ef5b8512`

The package hashes were checked against Docker's signed Debian repository
metadata. The signing key was obtained from the same official TLS origin and
was not independently pinned. The test needs macOS Virtualization.framework,
the Docker Desktop kernel and mkfs paths in the test, Go-built relay, a signed
Swift controller, and sufficient free disk space. It checks for at least 1 GiB
before each disposable 256 MiB disk. Outside-sandbox virtualization access was
required on the test host. With prepared inputs, run:

```sh
TURNLINK_DOCKER_VM_PROBE=1 \
TURNLINK_DOCKER_VM_INITRD=/absolute/path/to/initramfs.gz \
TURNLINK_DOCKER_VM_INITRD_SHA256=<sha256-of-initramfs> \
TURNLINK_DOCKER_VM_KEY=/absolute/path/to/test-secret \
node --test test/codex-dedicated-docker-vm.test.js
```

An independently isolated supervisor, authenticated host journal, verified
guest inputs, actual writer exclusion, and crash and I/O reconciliation are
still required before considering this boundary for Gate 2.

An additional fixture connects a private Unix socket through an XPC-owned VZ
connection to a guest-local Docker API relay. The guest holds a separate
authenticated control lease and restricts requests to its configured plugin
container. In an isolated VM, the control and API handshakes, Docker ping,
refusal of an unlisted endpoint, lease closure and VM stop passed. This test
does not establish a complete plugin workflow, production identity or
same-UID exclusion. Requests admitted before lease loss can still have effects
and remain uncertain. The initramfs used local fixture Docker binaries and
libraries with partially verified provenance; its hash only identifies that
particular fixture.
