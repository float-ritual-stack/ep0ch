#!/bin/sh
# Runs a test door (or anything) with none of the person's door settings: every inherited EP0CH_* is unset (the
# person's shell exports their Herdr daily agent, its folder, the landing and the now page), the agent drawer
# runs a shell, the door opens in its pane rather than as a session, and then the caller's own settings apply. Run it inside the pane or session the door runs in, so
# the environment that session got (a tmux server's own included) is cleaned too:
#   tmux new-session -d -s try "scripts/test-door-env.sh EP0CH_STATE=$d/s scripts/try-it.sh --showcase …"
for v in $(env | sed -n 's/^\(EP0CH_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done
unset EP0CH_DAILY_AGENT EP0CH_DAILY_CWD EP0CH_LANDING EP0CH_NOW_PAGE
# A test door opens in its pane, not as a session that outlives it: EP0CH_DAEMON=1 among the caller's settings asks for one
# (then end it, and any other its test started: EP0CH_STATE=… ep0ch session end --all --yes).
exec env EP0CH_DAILY_AGENT=sh EP0CH_DAEMON=0 "$@"
