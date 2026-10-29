#!/bin/sh
# The ssh door's ForceCommand, installed on float-box as ~/srv/ep0ch.io/door.sh (this file is its source: change it here,
# then copy it there, keeping a dated backup).
# ssh ep0ch.io on float-box: sshd forces this on port 2323 (Match LocalPort 2323). Since 2026-10-15 the door and its
# drawer agents run here (the crew moved off float-2); the outlines stay on float-2, reached with --machine float-2
# (the door forwards float-2's host socket to ~/outlines/.remote/float-2.sock). Each login attaches to the one door
# session (PIE-418). The client may send EP0CH_KITTY=1|0 (AcceptEnv) to force graphics on or off.
# `ssh ep0ch <outline>` (or a client's RemoteCommand) opens that outline instead of pie: an existing outline only,
# the door refuses one float-2 doesn't have.
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"
ws=pie
want=$(printf '%s' "${SSH_ORIGINAL_COMMAND:-}" | tr -d '[:space:]')
if [ -n "$want" ]; then
  case "$want" in *[!A-Za-z0-9._-]*|*.sqlite*) echo "ep0ch: not an outline name: $want"; exit 2;; esac
  if ! ssh -o BatchMode=yes -o ConnectTimeout=10 float-2 "test -f ~/outlines/$want.sqlite"; then
    echo "ep0ch: no outline named $want on float-2. These are: $(ssh -o BatchMode=yes float-2 'cd ~/outlines && for f in *.sqlite; do case "$f" in *.sqlite.*.sqlite) ;; *) printf "%s " "${f%.sqlite}";; esac; done')"
    exit 2
  fi
  ws=$want
fi
# The drawer's agent starts in this folder; its .ep0ch names the outline and the machine, so its outline tools write there.
mkdir -p "$HOME/outlines/$ws/door-claude"
[ -f "$HOME/outlines/$ws/door-claude/.ep0ch" ] || printf 'ws = "%s"\nmachine = "float-2"\n' "$ws" > "$HOME/outlines/$ws/door-claude/.ep0ch"
cd "$HOME/outlines/$ws/door-claude" || exit 1
# The door draws on stdout; its stderr and exit code go to a log, so a door that quits leaves its reason (PIE-1136).
L="$HOME/.local/state/ep0ch-door/client.log"
# A hangup (the link dropped) is noted after the client ends, so its exit is still logged (PIE-1429).
trap 'hup=" after a hangup"' HUP
bun "$HOME/projects/ep0ch/packages/door/src/main.ts" --ws "$ws" --machine float-2 2>>"$L"
code=$?
printf '%s door client exit %s%s (ws %s)\n' "$(date -Is)" "$code" "${hup:-}" "$ws" >>"$L"
# A client that didn't end itself cleanly may leave the terminal in the door's modes: give it back (mouse, paste, the
# Kitty keyboard, the alternate screen; the door's TERM_RESET) and say what reattaches. Over a dropped link nothing
# arrives; `ep0ch door` on the client's side does it there (src/machine.ts).
if [ "$code" -ne 0 ] && [ -t 1 ]; then
  printf '\033[<u\033[?2004l\033[?1006l\033[?1003l\033[?1002l\033[?1000l\033[0m\033[?7h\033[?25h\033[?1049l\r\n'
  echo "ep0ch: the door ended (exit $code) · ssh ep0ch reattaches"
fi
exit $code
