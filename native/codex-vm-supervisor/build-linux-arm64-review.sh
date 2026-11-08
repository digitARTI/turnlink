#!/bin/sh
# Offline, isolated review build. Prepare cargo/registry and cargo/git from a
# verified dependency cache first; no credentials, account or service setup.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
source_dir="$repo/.native-runtimes/codex"
cargo_dir="$repo/.native-runtimes/codex-linux-arm64-cargo"
target_dir="$repo/.native-runtimes/codex-linux-arm64-target"
v8_dir="$repo/.native-runtimes/codex-toolchain/v8-152.2.0-linux"
image='rust@sha256:bc2c4c21d4467cdbbac0ee7b95a6deb742a3467dfe0ff7647916c4b42ca56372'
manifest=rusty_v8_ptrcomp_sandbox_release_aarch64-unknown-linux-gnu.sha256
expected=94195fe3a70a6043474afabd145c0bbe322f409e95a52c745d64c9f929f80a22
test "$(shasum -a 256 "$v8_dir/$manifest" | cut -d ' ' -f 1)" = "$expected"
(cd "$v8_dir" && shasum -a 256 -c "$manifest")
test -d "$cargo_dir/registry" && test -d "$cargo_dir/git" && test -d "$target_dir"
python3 -c 'import shutil,sys; sys.exit(0 if shutil.disk_usage(sys.argv[1]).free >= 20 * 1024**3 else 1)' "$target_dir"
if [ -n "${TURNLINK_LINUX_TARGET_VOLUME:-}" ]; then
  case "$TURNLINK_LINUX_TARGET_VOLUME" in *[!a-zA-Z0-9_.-]*|'') exit 1 ;; esac
  target_mount="type=volume,src=$TURNLINK_LINUX_TARGET_VOLUME,dst=/target"
else
  target_mount="type=bind,src=$target_dir,dst=/target"
fi
exec /opt/homebrew/bin/docker run --rm --platform linux/arm64 --network none --read-only --cpus 2 --memory 6g \
  --user "$(id -u):$(id -g)" --tmpfs /tmp:rw,mode=1777,size=2g \
  --mount "type=bind,src=$source_dir,dst=/src,readonly" \
  --mount "type=bind,src=$cargo_dir,dst=/cargo" \
  --mount "$target_mount" \
  --mount "type=bind,src=$v8_dir,dst=/v8,readonly" \
  --workdir /src/codex-rs \
  --env HOME=/tmp --env CARGO_HOME=/cargo --env RUSTUP_HOME=/usr/local/rustup --env RUSTUP_TOOLCHAIN=1.99.1-aarch64-unknown-linux-gnu \
  --env CARGO_TARGET_DIR=/target --env CARGO_INCREMENTAL=0 --env CARGO_BUILD_JOBS=2 \
  --env "CARGO_LOG=${TURNLINK_CARGO_FINGERPRINT:-}" \
  --env 'RUSTFLAGS=-C debuginfo=0' \
  --env RUSTY_V8_ARCHIVE=/v8/librusty_v8_ptrcomp_sandbox_release_aarch64-unknown-linux-gnu.a.gz \
  --env RUSTY_V8_SRC_BINDING_PATH=/v8/src_binding_ptrcomp_sandbox_release_aarch64-unknown-linux-gnu.rs \
  "$image" cargo build --offline --locked -p codex-app-server --bin codex-app-server
