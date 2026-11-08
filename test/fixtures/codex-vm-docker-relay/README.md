# Guest Docker relay fixture

This test-only relay accepts a single lease and exposes a restricted subset of
the Docker API over guest vsock. It is not a production service, does not
authenticate guest processes or establish same-UID isolation, and does not
authorize migration or receiver release.

Build with `GO111MODULE=off GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build`.
Run the resulting executable with two arguments: a JSON configuration file and
a file containing exactly 32 raw fixture key bytes. The config has exactly
`scope`, `grantScope`, `image`, `name`, `sessionId`, and `directory`. The
`grantScope` is 64 lowercase hex characters; `image` is the pinned slim image in
the source. The scope is SHA-256 of the UTF-8 string formed by joining the
domain `turnlink-vm-docker-scope-v1`, grant scope, image, name, session ID and
directory using NUL separators. Configuration and key provisioning belong to
the fixture supervisor and must not be exposed to the workload.

The relay uses `/run/docker.sock` in the guest and creates an fsynced single-use
marker under `/state/turnlink-docker-leases/<scope>` before listening. It emits
`TURNLINK_DOCKER_LEASE_LISTENING` when vsock port 4052 is ready. A supervisor
must authenticate that port and keep the connection open. The control handshake
uses HMAC domains `turnlink-vm-docker-lease-v1` and
`turnlink-vm-docker-lease-ready-v1`. After it succeeds the relay listens on
4051 and prints `TURNLINK_DOCKER_RELAY_READY`. Data connections use domains
`turnlink-vm-docker-v1` and `turnlink-vm-docker-ready-v1`. Both handshakes use
JSONL frames of at most 512 bytes, independent random challenges and client
nonces, and the same lease scope. Any post-handshake byte or EOF on port 4052,
or five minutes of elapsed lease time, closes the relay and its streams.

Only the pinned image, fixed sealed command and requested single container are
accepted. HTTP requests are bounded and require explicit paths, query fields,
JSON fields and values. Duplicate keys are rejected recursively. Container and
exec IDs must have been returned by the daemon during this lease; attempted
create, attach, start, delete and exec-start operations are not retried. The
marker prevents a restarted fixture from reusing the scope. These measures are
not a substitute for protected state or a trusted guest: an effect admitted
before lease loss may still reach Docker and must be treated as uncertain.

Tests use in-process fake transports and pipes, not the Docker daemon. Run them
with `GO111MODULE=off go test -race`. On a host with the Docker CLI installed,
`TURNLINK_DOCKER_CLI_PROBE=1 GO111MODULE=off go test -run TestDockerCLICreateAgainstFakeDaemon`
also exercises real CLI create and exec against a fake daemon through an isolated
Unix socket. The actual VM, the image and the host-side control capability still
require independent integration verification.
