#!/bin/sh
# Open the door on a workspace's board, for a quick morning run.
#
#   scripts/try-it.sh --ws /home/evan/test                 the workspace's running service (real writes)
#   scripts/try-it.sh --ws /home/evan/test --copy --outliner <pi-herdr-outliner checkout>
#       a private copy of that workspace's database, served by its own service from <checkout>
#       (say, one with views.read and the change feed). Writes go to the copy, which is deleted on exit.
#   scripts/try-it.sh --showcase [--reset] [--prepare] --outliner <pi-herdr-outliner checkout>
#       the showcase (PIE-439): every shared door part on a seeded, made-up outline, served privately
#       from ${XDG_STATE_HOME:-~/.local/state}/ep0ch-door/showcase. Seeded on first run; edits persist
#       until --reset stops its service, deletes that state and reseeds. --prepare sets it up and exits.
#
# --hub <block-id> opens that board; otherwise the door picks the workspace's board (or asks).
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
ws=""; copy=0; hub=""; outliner="${EP0CH_OUTLINER:-}"; showcase=0; reset=0; prepare=0
while [ $# -gt 0 ]; do
  case "$1" in
    --ws) ws="$2"; shift 2 ;;
    --copy) copy=1; shift ;;
    --outliner) outliner="$2"; shift 2 ;;
    --hub) hub="$2"; shift 2 ;;
    --showcase) showcase=1; shift ;;
    --reset) reset=1; shift ;;
    --prepare) prepare=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done
[ "$showcase" = 1 ] || [ "$reset$prepare" = 00 ] || { echo "--reset and --prepare go with --showcase" >&2; exit 2; }
[ "$showcase" = 1 ] || [ -n "$ws" ] || { echo "say which workspace: --ws <workspace root>" >&2; exit 2; }
command -v bun >/dev/null || { echo "bun isn't on PATH" >&2; exit 2; }
[ -d "$here/node_modules" ] || (cd "$here" && bun install >/dev/null)

hash_of() { printf '%s' "$1" | sha256sum | cut -c1-12; }

# A private outliner service: its own state, workspace and config dirs, background agents off, Herdr
# unset, so nothing reaches a real outline. `serve <dir> <workspace> <log>`; sets $pid and $sock.
serve() {
  (cd "$outliner" && exec env -u HERDR_ENV -u HERDR_SOCKET_PATH -u HERDR_PANE_ID -u HERDR_WORKSPACE_ID -u HERDR_TAB_ID \
    OUTLINER_STATE_DIR="$1/state" OUTLINER_WORKSPACE_ROOT="$2" XDG_CONFIG_HOME="$1/config" \
    OUTLINER_INBOX_AGENT=0 OUTLINER_NOTE_ASSISTANCE=0 bun src/server-main.ts >"$3" 2>&1) &
  pid=$!
  sock="$1/state/$(hash_of "$2")/outliner.sock"
  i=0; while [ ! -S "$sock" ]; do
    i=$((i + 1))
    if [ $i -gt 100 ] || ! kill -0 "$pid" 2>/dev/null; then echo "the private service didn't start; see $3" >&2; cat "$3" >&2; exit 1; fi
    sleep 0.2
  done
}
need_outliner() {
  [ -n "$outliner" ] && [ -f "$outliner/src/server-main.ts" ] || { echo "$1 needs --outliner <pi-herdr-outliner checkout> (or EP0CH_OUTLINER)" >&2; exit 2; }
}

if [ "$showcase" = 1 ]; then
  need_outliner --showcase
  base="${XDG_STATE_HOME:-$HOME/.local/state}/ep0ch-door/showcase"
  pidfile="$base/service.pid"
  running() { [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; }
  if [ "$reset" = 1 ]; then
    if running; then
      old=$(cat "$pidfile"); kill "$old" 2>/dev/null || true
      i=0; while kill -0 "$old" 2>/dev/null; do i=$((i + 1)); [ $i -gt 50 ] && { kill -9 "$old" 2>/dev/null || true; break; }; sleep 0.2; done
      echo "stopped the showcase service ($old)"
    fi
    rm -rf "$base"
    echo "reset: deleted $base"
  fi
  mkdir -p "$base/ws" "$base/state" "$base/config" "$base/door"
  sc_ws=$(cd "$base/ws" && pwd)
  pid=""; mine=0
  if running; then sock="$base/state/$(hash_of "$sc_ws")/outliner.sock"
  else serve "$base" "$sc_ws" "$base/service.log"; mine=1; echo "$pid" >"$pidfile"; fi
  stop() { if [ "$mine" = 1 ] && [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; rm -f "$pidfile"; fi; }
  trap stop EXIT INT TERM
  # Seeded once: the marker is written only when the whole seed landed (a half seed says to --reset).
  if [ ! -f "$base/seeded" ]; then
    (cd "$here" && bun scripts/showcase.ts seed "$sock") || { echo "not seeded; scripts/try-it.sh --showcase --reset starts over" >&2; exit 1; }
    touch "$base/seeded"
  fi
  [ "$prepare" = 1 ] && exit 0
  echo "door → the showcase at $base (made-up notes; edits stay until --reset)"
  echo "      control socket: EP0CH_CONTROL=$base/door/door.sock"
  cd "$here" && EP0CH_STATE="$base/door" EP0CH_CONTROL="$base/door/door.sock" OUTLINER_STATE_DIR="$base/state" bun src/main.ts --ws "$sc_ws" --showcase
  exit $?
fi

ws=$(cd "$ws" && pwd)
state_base="${OUTLINER_STATE_DIR:-$HOME/.local/state/pi-herdr-outliner}"

if [ "$copy" = 0 ]; then
  sock="$state_base/$(hash_of "$ws")/outliner.sock"
  [ -S "$sock" ] || { echo "no service is running for $ws (no socket at $sock)" >&2; exit 1; }
  echo "door → $ws (its running service; edits, moves and comments are real)"
  cd "$here" && exec bun src/main.ts --ws "$ws" --board $hub
fi

# --copy: a private service on a copy of the database, never the live one.
need_outliner --copy
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
serve "$tmp" "$copy_ws" "$tmp/server.log"
echo "door → a private copy of $ws, served from $outliner (writes stay in the copy, deleted on exit)"
cd "$here" && OUTLINER_STATE_DIR="$tmp/state" bun src/main.ts --ws "$copy_ws" --board $hub
