#!/bin/sh
# Open the door on an outline's board, for a quick morning run.
#
#   scripts/try-it.sh --ws pie                     the outline on this machine's host (real writes)
#   scripts/try-it.sh --ws pie --copy              a private copy of that outline (<outlines>/pie.sqlite),
#       served by a host of its own from this repository's outliner (or --outliner <dir>). Writes go to the
#       copy, which is deleted on exit.
#   scripts/try-it.sh --showcase [--reset] [--prepare] [--screen <name> [<target>]]
#       the showcase (PIE-439): every shared door part on a seeded, made-up outline, served privately
#       from <the door's state>/showcase (EP0CH_STATE, else ${XDG_STATE_HOME:-~/.local/state}/ep0ch-door). Seeded on first run; edits persist
#       until --reset stops its host, deletes that state and reseeds. --prepare sets it up and exits. --screen opens
#       that screen over the main menu on it, instead of the showcase's sections.
#
# --hub <block-id> opens that board; otherwise the door picks the outline's board (or asks).
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
sname=""; starget=""; ws=""; copy=0; hub=""; outliner="${EP0CH_OUTLINER:-$here/../outliner}"; showcase=0; reset=0; prepare=0
while [ $# -gt 0 ]; do
  case "$1" in
    --ws) ws="$2"; shift 2 ;;
    --copy) copy=1; shift ;;
    --outliner) outliner="$2"; shift 2 ;;
    --hub) hub="$2"; shift 2 ;;
    --showcase) showcase=1; shift ;;
    --reset) reset=1; shift ;;
    --prepare) prepare=1; shift ;;
    --screen) [ $# -ge 2 ] || { echo "--screen needs a screen's name" >&2; exit 2; }; sname="$2"; shift 2; case "${1:-}" in ''|-*) ;; *) starget="$1"; shift ;; esac ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done
[ "$showcase" = 1 ] || [ "$reset$prepare" = 00 ] || { echo "--reset and --prepare go with --showcase" >&2; exit 2; }
[ "$showcase" = 1 ] || [ -n "$ws" ] || { echo "say which outline: --ws <name>" >&2; exit 2; }
command -v bun >/dev/null || { echo "bun isn't on PATH" >&2; exit 2; }
[ -d "$here/../../node_modules" ] || (cd "$here" && bun install >/dev/null)

# Stop a process this script started: TERM, then KILL after 10 s.
halt() {
  kill "$1" 2>/dev/null || true
  i=0; while kill -0 "$1" 2>/dev/null; do i=$((i + 1)); [ $i -gt 50 ] && { kill -9 "$1" 2>/dev/null || true; break; }; sleep 0.2; done
  wait "$1" 2>/dev/null || true
}

# A private outline host over `<dir>/outlines`, `<name>` its default (made when missing), background agents off,
# Herdr unset, so nothing reaches a real outline. `serve <dir> <name> <log>`; sets $pid and $sock.
serve() {
  mkdir -p "$1/outlines" "$1/config"
  # The -u list is HERDR_VARS in src/desk/pty.ts (test/runtime-parts.test.ts checks they match).
  (cd "$outliner" && exec env -u HERDR_ENV -u HERDR_SOCKET_PATH -u HERDR_PANE_ID -u HERDR_WORKSPACE_ID -u HERDR_TAB_ID -u EP0CH_SOCKET -u EP0CH_WS -u EP0CH_MACHINE \
    EP0CH_OUTLINES="$1/outlines" EP0CH_DEFAULT_WS="$2" XDG_CONFIG_HOME="$1/config" \
    bun src/host-main.ts >"$3" 2>&1) &
  pid=$!
  sock="$1/outlines/.host/host.sock"
  # 0.2 s a check; EP0CH_TRY_START_CHECKS shortens the wait for tests.
  i=0; while [ ! -S "$sock" ]; do
    i=$((i + 1))
    if [ $i -gt "${EP0CH_TRY_START_CHECKS:-100}" ] || ! kill -0 "$pid" 2>/dev/null; then
      # Stopped before exiting: a host left running here would serve the same outlines beside the next one.
      halt "$pid"
      echo "the private host didn't start; see $3" >&2; cat "$3" >&2; exit 1
    fi
    sleep 0.2
  done
  # Its default outline, made when it isn't there yet (a copy is).
  (cd "$here" && EP0CH_OUTLINES="$1/outlines" EP0CH_SOCKET= EP0CH_MACHINE= bun src/main.ts outline attach "$2" --here --json >/dev/null)
}
need_outliner() {
  [ -f "$outliner/src/host-main.ts" ] || { echo "$1 needs the outliner package (--outliner <dir>, or EP0CH_OUTLINER); $outliner has none" >&2; exit 2; }
}

if [ "$showcase" = 1 ]; then
  need_outliner --showcase
  base="${EP0CH_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/ep0ch-door}/showcase"
  pidfile="$base/service.pid"
  # Is process $1 this showcase's host? A pidfile outlives a crash, a SIGKILL or a reboot, and the
  # OS may have given its pid to something else since: the process must be the outliner's host,
  # serving this showcase's outlines. Without /proc, `ps` must show both in its command and environment.
  ours() {
    if [ -r "/proc/$1/environ" ]; then
      tr '\0' '\n' <"/proc/$1/cmdline" 2>/dev/null | grep -q 'host-main\.ts$' &&
        tr '\0' '\n' <"/proc/$1/environ" 2>/dev/null | grep -qxF "EP0CH_OUTLINES=$base/outlines"
    else
      ps -E -ww -o command= -p "$1" 2>/dev/null | grep -F 'host-main.ts' | grep -qF "EP0CH_OUTLINES=$base/outlines"
    fi
  }
  # The showcase's host is running (its pid in $pidfile). A pidfile naming anything else is stale:
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
  mkdir -p "$base/outlines" "$base/config" "$base/door"
  pid=""; mine=0; stale=0
  sock="$base/outlines/.host/host.sock"
  if ! running; then
    # The host a stale pidfile named left its socket behind: serve would take it for the new one's.
    [ "$stale" = 0 ] || rm -f "$sock"
    serve "$base" showcase "$base/service.log"; mine=1; echo "$pid" >"$pidfile"
  fi
  # The pidfile is removed only while it still names this run's host: a --reset run since then stopped it and wrote its own.
  stop() { if [ "$mine" = 1 ] && [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; if [ "$(cat "$pidfile" 2>/dev/null)" = "$pid" ]; then rm -f "$pidfile"; fi; fi; }
  trap stop EXIT INT TERM
  # Seeded once: the marker is written only when the whole seed landed (a half seed says to --reset).
  if [ ! -f "$base/seeded" ]; then
    (cd "$here" && bun scripts/showcase.ts seed "$sock" "$base/config" "$outliner") || { echo "not seeded; scripts/try-it.sh --showcase --reset starts over" >&2; exit 1; }
    touch "$base/seeded"
  fi
  [ "$prepare" = 1 ] && exit 0
  echo "door → the showcase at $base (made-up notes; edits stay until --reset)"
  echo "      control socket: EP0CH_CONTROL=$base/door/door.sock"
  set -- --no-daemon --ws showcase --showcase
  [ -z "$sname" ] || set -- "$@" --screen "$sname"
  [ -z "$starget" ] || set -- "$@" "$starget"
  cd "$here" && EP0CH_STATE="$base/door" EP0CH_CONTROL="$base/door/door.sock" EP0CH_OUTLINES="$base/outlines" EP0CH_SOCKET= EP0CH_MACHINE= \
    bun src/main.ts --here "$@"
  exit $?
fi

outlines="${EP0CH_OUTLINES:-$HOME/outlines}"
if [ "$copy" = 0 ]; then
  echo "door → the outline $ws on this machine's host (edits, moves and comments are real)"
  cd "$here" && exec bun src/main.ts --no-daemon --ws "$ws" --screen board $hub
fi

# --copy: a private host on a copy of the database, never the live one.
need_outliner --copy
command -v sqlite3 >/dev/null || { echo "--copy needs sqlite3" >&2; exit 2; }
live="$outlines/$ws.sqlite"
[ -f "$live" ] || { echo "no outline $ws at $live" >&2; exit 1; }
tmp=$(mktemp -d "${TMPDIR:-/tmp}/ep0ch-try-XXXXXX")
pid=""
cleanup() { if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi; rm -rf "$tmp"; }
trap cleanup EXIT INT TERM
mkdir -p "$tmp/outlines"
sqlite3 -readonly "$live" ".backup '$tmp/outlines/$ws.sqlite'"
serve "$tmp" "$ws" "$tmp/host.log"
echo "door → a private copy of $ws, served from $outliner (writes stay in the copy, deleted on exit)"
# A copy is on this machine, whatever EP0CH_MACHINE or a .ep0ch says: --here names it over both.
cd "$here" && EP0CH_OUTLINES="$tmp/outlines" EP0CH_SOCKET= EP0CH_MACHINE= bun src/main.ts --here --no-daemon --ws "$ws" --screen board $hub
