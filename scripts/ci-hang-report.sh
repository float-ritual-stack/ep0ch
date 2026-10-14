#!/usr/bin/env bash
# What a test run still going at the watchdog's deadline was doing, before it's stopped (CI, .github/workflows/test.yml).
# First the machine: its load, CPU steal and pressure, and the busiest processes anywhere on it (a neighbour, an orphan a
# test left, a runner slowed down: Oct 14's run was "hung" only because every parity test ran 2-3x slower at once,
# PIE-831). Then the run: the last of its output (which tests were still going), every process under <pid> with its
# state, CPU and what it waits in, the zombies among them, and for each one spinning (state R) its threads' kernel
# stacks and native stacks (gdb), the main thread first (the 400-line cut once fell on it).
#
#   scripts/ci-hang-report.sh <pid> [<output file>]   on the runner (sudo: gdb attaches to a process it didn't start);
#                                                     the workflow bounds the whole report (timeout 150), each gdb 40 s
set -u
root=$1 out=${2:-}
echo "== the machine"
uptime
grep -h . /proc/pressure/cpu 2>/dev/null | sed 's/^/cpu pressure: /'
echo "-- vmstat 1 5 (st: CPU stolen by the hypervisor)"
vmstat 1 5 2>/dev/null
echo "-- the job's cgroup: its CPU limit and how long it was throttled"
cat /sys/fs/cgroup/cpu.max /sys/fs/cgroup/cpu.stat 2>/dev/null
echo "-- the busiest processes, anywhere"
top -b -n 1 -c -w 220 -o %CPU 2>/dev/null | head -32
if [ -n "$out" ] && [ -f "$out" ]; then
  echo "== the run's output, its last 40 lines (written $(( $(date +%s) - $(stat -c %Y "$out") ))s ago)"
  tail -n 40 "$out" | cut -c1-240
fi
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
  # The main thread (gdb's thread 1, the one a spinning worker spins on) whole, then every thread's top frames.
  sudo timeout 40 gdb -p "$p" -batch -nx -ex "set pagination off" -ex "thread apply 1 bt 60" -ex "thread apply all bt 12" 2>&1 | grep -v '^\[New LWP\|^warning:' | head -600
done
