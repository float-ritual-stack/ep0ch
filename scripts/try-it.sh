#!/bin/sh
# Open the door on a workspace's board, for a quick morning run.
#
#   scripts/try-it.sh --ws /home/evan/test                 the workspace's running service (real writes)
#   scripts/try-it.sh --ws /home/evan/test --copy --outliner <pi-herdr-outliner checkout>
#       a private copy of that workspace's database, served by its own service from <checkout>
#       (say, one with views.read and the change feed). Writes go to the copy, which is deleted on exit.
#
# --hub <block-id> opens that board; otherwise the door picks the workspace's board (or asks).
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
ws=""; copy=0; hub=""; outliner="${EP0CH_OUTLINER:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --ws) ws="$2"; shift 2 ;;
    --copy) copy=1; shift ;;
    --outliner) outliner="$2"; shift 2 ;;
    --hub) hub="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done
[ -n "$ws" ] || { echo "say which workspace: --ws <workspace root>" >&2; exit 2; }
ws=$(cd "$ws" && pwd)
command -v bun >/dev/null || { echo "bun isn't on PATH" >&2; exit 2; }
[ -d "$here/node_modules" ] || (cd "$here" && bun install >/dev/null)

state_base="${OUTLINER_STATE_DIR:-$HOME/.local/state/pi-herdr-outliner}"
hash_of() { printf '%s' "$1" | sha256sum | cut -c1-12; }

if [ "$copy" = 0 ]; then
  sock="$state_base/$(hash_of "$ws")/outliner.sock"
  [ -S "$sock" ] || { echo "no service is running for $ws (no socket at $sock)" >&2; exit 1; }
  echo "door → $ws (its running service; edits, moves and comments are real)"
  cd "$here" && exec bun src/main.ts --ws "$ws" --board $hub
fi

# --copy: a private service on a copy of the database, never the live one.
[ -n "$outliner" ] && [ -f "$outliner/src/server-main.ts" ] || { echo "--copy needs --outliner <pi-herdr-outliner checkout> (or EP0CH_OUTLINER)" >&2; exit 2; }
command -v sqlite3 >/dev/null || { echo "--copy needs sqlite3" >&2; exit 2; }
live="$state_base/$(hash_of "$ws")/outliner.sqlite"
[ -f "$live" ] || { echo "no database for $ws at $live" >&2; exit 1; }
tmp=$(mktemp -d "${TMPDIR:-/tmp}/ep0ch-try-XXXXXX")
pid=""
cleanup() { if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi; rm -rf "$tmp"; }
trap cleanup EXIT INT TERM
mkdir -p "$tmp/ws" "$tmp/state" "$tmp/config"
copy_ws=$(cd "$tmp/ws" && pwd)
mkdir -p "$tmp/state/$(hash_of "$copy_ws")"
sqlite3 -readonly "$live" ".backup '$tmp/state/$(hash_of "$copy_ws")/outliner.sqlite'"
(cd "$outliner" && exec env -u HERDR_ENV -u HERDR_SOCKET_PATH -u HERDR_PANE_ID -u HERDR_WORKSPACE_ID -u HERDR_TAB_ID \
  OUTLINER_STATE_DIR="$tmp/state" OUTLINER_WORKSPACE_ROOT="$copy_ws" XDG_CONFIG_HOME="$tmp/config" \
  OUTLINER_INBOX_AGENT=0 OUTLINER_NOTE_ASSISTANCE=0 bun src/server-main.ts >"$tmp/server.log" 2>&1) &
pid=$!
sock="$tmp/state/$(hash_of "$copy_ws")/outliner.sock"
i=0; while [ ! -S "$sock" ]; do i=$((i + 1)); [ $i -gt 100 ] && { echo "the private service didn't start; see $tmp/server.log" >&2; cat "$tmp/server.log" >&2; exit 1; }; sleep 0.2; done
echo "door → a private copy of $ws, served from $outliner (writes stay in the copy, deleted on exit)"
cd "$here" && OUTLINER_STATE_DIR="$tmp/state" bun src/main.ts --ws "$copy_ws" --board $hub
