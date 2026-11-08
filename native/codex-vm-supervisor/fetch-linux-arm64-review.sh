#!/bin/sh
# Network-enabled dependency preparation only. The container has no host
# credentials or user home mounted and Cargo verifies the locked packages.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
source_dir="$repo/.native-runtimes/codex"
cargo_dir="$repo/.native-runtimes/codex-linux-arm64-cargo"
target_dir="$repo/.native-runtimes/codex-linux-arm64-target"
image='rust@sha256:bc2c4c21d4467cdbbac0ee7b95a6deb742a3467dfe0ff7647916c4b42ca56372'
mkdir -p "$cargo_dir" "$target_dir"
exec /opt/homebrew/bin/docker run --rm --platform linux/arm64 --read-only --cpus 2 --memory 2g \
  --user "$(id -u):$(id -g)" --tmpfs /tmp:rw,mode=1777,size=1g \
  --mount "type=bind,src=$source_dir,dst=/src,readonly" \
  --mount "type=bind,src=$cargo_dir,dst=/cargo" --workdir /src/codex-rs \
  --env HOME=/tmp --env CARGO_HOME=/cargo --env RUSTUP_HOME=/usr/local/rustup \
  --env RUSTUP_TOOLCHAIN=1.99.1-aarch64-unknown-linux-gnu \
  "$image" cargo fetch --locked --target aarch64-unknown-linux-gnu
