#!/bin/sh
set -eu

# The installed Codex Desktop 0.135 runtime does not participate in the writer
# lock used by supported standalone Codex. Keep its state physically separate
# from ~/.codex even when the parent desktop process inherited another value.
desktop_home="$HOME/Library/Application Support/Turnlink/CodexDesktopHome"
runtime_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
original="$runtime_dir/codex.turnlink-unisolated-0.135.0-alpha.1"

if [ "$desktop_home" = "$HOME/.codex" ]; then
  echo "refusing shared Codex home" >&2
  exit 126
fi

umask 077
mkdir -p "$desktop_home"
chmod 700 "$desktop_home"
export CODEX_HOME="$desktop_home"
export CODEX_SQLITE_HOME="$desktop_home"
exec "$original" "$@"
