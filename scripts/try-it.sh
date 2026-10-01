#!/bin/sh
# Open the door on a workspace's board, for a quick morning run.
#
#   scripts/try-it.sh --ws /home/evan/test                 the workspace's running service (real writes)
#   scripts/try-it.sh --ws /home/evan/test --copy --outliner <pi-herdr-outliner checkout>
#       a private copy of that workspace's database, served by its own service from <checkout>
#       (say, one with views.read and the change feed). Writes go to the copy, which is deleted on exit.
#   scripts/try-it.sh --showcase [--reset] [--prepare] --outliner <pi-herdr-outliner checkout>
#       the showcase (PIE-439): every shared door part on a seeded, made-up outline, served privately
#       from <the door's state>/showcase (EP0CH_STATE, else ${XDG_STATE_HOME:-~/.local/state}/ep0ch-door). Seeded on first run; edits persist
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
# Stop a process this script started: TERM, then KILL after 10 s.
halt() {
  kill "$1" 2>/dev/null || true
  i=0; while kill -0 "$1" 2>/dev/null; do i=$((i + 1)); [ $i -gt 50 ] && { kill -9 "$1" 2>/dev/null || true; break; }; sleep 0.2; done
  wait "$1" 2>/dev/null || true
}

# A private outliner service: its own state, workspace and config dirs, background agents off, Herdr
# unset, so nothing reaches a real outline. `serve <dir> <workspace> <log>`; sets $pid and $sock.
serve() {
  # The -u list is HERDR_VARS in src/desk/pty.ts (test/runtime-parts.test.ts checks they match).
  (cd "$outliner" && exec env -u HERDR_ENV -u HERDR_SOCKET_PATH -u HERDR_PANE_ID -u HERDR_WORKSPACE_ID -u HERDR_TAB_ID \
    OUTLINER_STATE_DIR="$1/state" OUTLINER_WORKSPACE_ROOT="$2" XDG_CONFIG_HOME="$1/config" \
    OUTLINER_INBOX_AGENT=0 OUTLINER_NOTE_ASSISTANCE=0 bun src/server-main.ts >"$3" 2>&1) &
  pid=$!
  sock="$1/state/$(hash_of "$2")/outliner.sock"
  # 0.2 s a check; EP0CH_TRY_START_CHECKS shortens the wait for tests.
  i=0; while [ ! -S "$sock" ]; do
    i=$((i + 1))
    if [ $i -gt "${EP0CH_TRY_START_CHECKS:-100}" ] || ! kill -0 "$pid" 2>/dev/null; then
      # Stopped before exiting: a service left running here would serve the same state beside the next one.
      halt "$pid"
      echo "the private service didn't start; see $3" >&2; cat "$3" >&2; exit 1
    fi
    sleep 0.2
  done
}
need_outliner() {
  [ -n "$outliner" ] && [ -f "$outliner/src/server-main.ts" ] || { echo "$1 needs --outliner <pi-herdr-outliner checkout> (or EP0CH_OUTLINER)" >&2; exit 2; }
}

if [ "$showcase" = 1 ]; then
  need_outliner --showcase
  base="${EP0CH_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/ep0ch-door}/showcase"
  pidfile="$base/service.pid"
  # Is process $1 this showcase's service? A pidfile outlives a crash, a SIGKILL or a reboot, and the
  # OS may have given its pid to something else since: the process must be the outliner's server,
  # serving this showcase's state. Without /proc, `ps` must show both in its command and environment.
  ours() {
    if [ -r "/proc/$1/environ" ]; then
      tr '\0' '\n' <"/proc/$1/cmdline" 2>/dev/null | grep -q 'server-main\.ts$' &&
        tr '\0' '\n' <"/proc/$1/environ" 2>/dev/null | grep -qxF "OUTLINER_STATE_DIR=$base/state"
    else
      ps -E -ww -o command= -p "$1" 2>/dev/null | grep -F 'server-main.ts' | grep -qF "OUTLINER_STATE_DIR=$base/state"
    fi
  }
  # The showcase's service is running (its pid in $pidfile). A pidfile naming anything else is stale:
  # it's removed, and that process is left alone.
  running() {
    [ -f "$pidfile" ] || return 1
    p=$(cat "$pidfile")
    case "$p" in ''|*[!0-9]*) rm -f "$pidfile"; return 1 ;; esac
    kill -0 "$p" 2>/dev/null && ours "$p" && return 0
    rm -f "$pidfile"; stale=1
    echo "the showcase pidfile named process $p, which isn't its service (gone, or another process now); left it alone" >&2
    return 1
  }
  if [ "$reset" = 1 ]; then
    if running; then
      old=$(cat "$pidfile"); halt "$old"
      echo "stopped the showcase service ($old)"
    fi
    rm -rf "$base"
    echo "reset: deleted $base"
  fi
  mkdir -p "$base/ws" "$base/state" "$base/config" "$base/door"
  sc_ws=$(cd "$base/ws" && pwd)
  pid=""; mine=0; stale=0
  sock="$base/state/$(hash_of "$sc_ws")/outliner.sock"
  if ! running; then
    # The service a stale pidfile named left its socket behind: serve would take it for the new one's.
    [ "$stale" = 0 ] || rm -f "$sock"
    serve "$base" "$sc_ws" "$base/service.log"; mine=1; echo "$pid" >"$pidfile"
  fi
  stop() { if [ "$mine" = 1 ] && [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; rm -f "$pidfile"; fi; }
  trap stop EXIT INT TERM
  # Seeded once: the marker is written only when the whole seed landed (a half seed says to --reset).
  if [ ! -f "$base/seeded" ]; then
    (cd "$here" && bun scripts/showcase.ts seed "$sock" "$base/config" "$outliner") || { echo "not seeded; scripts/try-it.sh --showcase --reset starts over" >&2; exit 1; }
    touch "$base/seeded"
  fi
  # The outliner's status renderer, installed for this door the way a reader host installs it, so the
  # notebook's ```component:status fence draws its panel (PIE-444). Without the manifest the reader says why.
  renderers="$base/config/pi-herdr-outliner/document-renderers.json"
  if [ -f "$outliner/extensions/status-summary/manifest.json" ]; then
    mkdir -p "$base/config/pi-herdr-outliner"
    cp "$outliner/extensions/status-summary/manifest.json" "$base/config/pi-herdr-outliner/status.json"
    printf '{"version":1,"renderers":{"status":{"manifest":"%s","enabled":true}}}\n' "$base/config/pi-herdr-outliner/status.json" >"$renderers"
  fi
  [ "$prepare" = 1 ] && exit 0
  echo "door → the showcase at $base (made-up notes; edits stay until --reset)"
  echo "      control socket: EP0CH_CONTROL=$base/door/door.sock"
  cd "$here" && EP0CH_STATE="$base/door" EP0CH_CONTROL="$base/door/door.sock" OUTLINER_STATE_DIR="$base/state" \
    OUTLINER_DOCUMENT_RENDERERS="$renderers" bun src/main.ts --ws "$sc_ws" --showcase
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
