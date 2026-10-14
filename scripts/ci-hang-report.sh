#!/usr/bin/env bash
# What a hung test run was doing, before it's stopped (CI, .github/workflows/test.yml): every process under <pid> with
# its state, CPU and what it waits in, the zombies among them, and for each one spinning (state R) its threads' native
# stacks (gdb) and kernel stacks. A run seen hanging about 1 in 40 (October: a bun test worker at 100% CPU with an
# unreaped child, after its tests had reported) left nothing to read; this is what the next one leaves.
#
#   scripts/ci-hang-report.sh <pid>      on the runner (sudo: gdb attaches to a process it didn't start); the workflow
#                                        bounds the whole report (timeout 150), and each gdb here to 40 s
set -u
root=$1
# The process and every descendant (by parent pid: pstree may not be there).
pids=$(ps -eo pid=,ppid= | awk -v r="$root" '{ kid[$2] = kid[$2] " " $1 } END { q[1] = r; n = 1; for (i = 1; i <= n; i++) { print q[i]; m = split(kid[q[i]], k, " "); for (j = 1; j <= m; j++) q[++n] = k[j] } }')
echo "== processes under $root (pid stat %cpu elapsed wchan command)"
for p in $pids; do ps -o pid=,stat=,pcpu=,etime=,wchan:24=,args= -p "$p" 2>/dev/null | cut -c1-240; done
echo "== zombies"
for p in $pids; do ps -o pid=,ppid=,stat=,args= -p "$p" 2>/dev/null | awk '$3 ~ /Z/'; done
command -v gdb >/dev/null || timeout 60 sudo apt-get install -y --no-install-recommends gdb >/dev/null 2>&1
for p in $pids; do
  st=$(ps -o stat= -p "$p" 2>/dev/null) || continue
  case $st in R*) ;; *) continue;; esac
  echo "== $p is running: its threads"
  sudo cat /proc/"$p"/task/*/stat 2>/dev/null | awk '{print "tid " $1 " " $2 " state " $3 " utime " $14 " stime " $15}'
  echo "-- kernel stacks"
  for t in /proc/"$p"/task/*; do echo "tid ${t##*/}"; sudo cat "$t"/stack 2>/dev/null | head -12; done
  echo "-- native stacks (gdb)"
  sudo timeout 40 gdb -p "$p" -batch -nx -ex "set pagination off" -ex "thread apply all bt 40" 2>&1 | grep -v '^\[New LWP\|^warning:' | head -400
done
