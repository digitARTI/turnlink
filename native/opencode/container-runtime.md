# Experimental Linux runtime image

This is a runtime-only fixture for evaluating OpenCode owner containment. It
does not contain OpenCode, connect to the broker, mount a workspace, or enable
takeover. It is not a production image.

The verified local base was `jarvis-suite:local`, image ID
`sha256:d508a6bbb14b68954ce50d40e9e50d18ea36f073528300e4c7c8396c3c2d3d47`
(Linux arm64, Debian 13). Check that exact ID before building: the local tag can
be replaced and the Dockerfile alone does not enforce its identity.

The two official archives were downloaded separately and verified against the
publishers' `SHASUMS256.txt` files:

| Archive | SHA-256 |
| --- | --- |
| `https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-arm64.tar.xz` | `6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2` |
| `https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-aarch64.zip` | `54328bbc2d9c8e0c9f892c544d66c57a83b84139e34909e5ee81758f1ac8fda7` |

The build context contained only the Dockerfile and the `node` and `bun`
executables extracted from those archives. Build it with
`docker build --network=none --pull=false`; do not copy a checkout or secrets
into the context. On this host the resulting image ID was
`sha256:70f8f1b1db2b51bf020196dd0facb81355edefeaaf04fbd9146aa60d91d8bff5`.
With a read-only root, no mounts, no network, dropped capabilities and
`no-new-privileges`, the binaries reported Node `v24.21.0` and Bun `1.4.2`.
Byte-identical image output is not guaranteed across Docker builders.

## Dedicated owner fixture

A separate, experimental owner image built offline from the runtime above
contains a prebuilt OpenCode recovery host, plugin, and relay scripts. The local
image ID is `sha256:9f540f385b36f30d4084c73a4741d1122bd290abb97e95cfc6b92062d56aa136`.
Its asset set has aggregate SHA-256
`3ec3b116688d69c5f39701bd76af9057ca0594e769a7ff529d7d1781bd7a4e8d`,
computed over sorted relative paths and each file's SHA-256, separated as
`path\0digest\n`. The native bundle derives from OpenCode tree
`27fe131feefb18761cca6b2f3bcc6d6171cc2824`; the recovery-host bundle SHA-256
is `02255da975fc34961c000d3018d871e37d19b19d4f037a63837fd698dc7f2fad`.
The plugin bundle SHA-256 is
`6841f4c7dff28905c2cba751403a3e139d6894d1fff40222c37af1aeaefd888f`.
This identifies the local artifact; it is not a reproducible-build guarantee.

The opt-in `test/opencode-contained-plugin.test.js` exercises this image with
no host bind mounts, a dedicated Docker volume for SQLite and workspace, a
networkless container, and relays to a host broker and a fake model. A fixture
token is supplied over the private startup stream into a mode-0600 tmpfs file;
the test checks it is absent from container environment, command, and writable
layer. This does not prove that a process with the same UID cannot read it, or
that copies cannot exist in memory. The test proves plugin registration, not
broker-authorized takeover after a crash. The mode remains experimental.
