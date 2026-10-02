#!/bin/sh
# Runs a test door (or anything) with none of the person's door settings: every inherited EP0CH_* is unset (the
# person's shell exports their Herdr daily agent, its folder, the landing and the now page), the agent drawer
# runs a shell, and then the caller's own settings apply. Run it inside the pane or session the door runs in, so
# the environment that session got (a tmux server's own included) is cleaned too:
#   tmux new-session -d -s try "scripts/test-door-env.sh EP0CH_STATE=$d/s scripts/try-it.sh --showcase …"
for v in $(env | sed -n 's/^\(EP0CH_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done
unset EP0CH_DAILY_AGENT EP0CH_HERDR_AGENT_CMD EP0CH_DAILY_CWD EP0CH_LANDING EP0CH_NOW_PAGE
exec env EP0CH_DAILY_AGENT=sh "$@"
