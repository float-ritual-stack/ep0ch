#!/usr/bin/env bash
# The CI runner while a test run goes on (.github/workflows/test.yml), a line every 30 s until it's stopped: the load,
# where the CPU went since the line before (user, system, idle and stolen by the hypervisor, in percent of the whole
# machine), how long the job's cgroup was throttled meanwhile, and the three busiest processes then. A run that slows
# down part-way (Oct 13-14: every parity test 2-3x slower at once, two minutes in, PIE-831) shows here when and why:
# steal or throttling is the runner, a process outside the run is a neighbour or an orphan a test left.
#
#   scripts/ci-machine-sample.sh <file>      in the background; the workflow stops it and uploads the file
set -u
file=$1
cpu() { awk '/^cpu /{ print $2+$3, $4, $5+$6, $9, $2+$3+$4+$5+$6+$7+$8+$9 }' /proc/stat; }
throttled() { awk '/^throttled_usec/{ print $2 }' /sys/fs/cgroup/cpu.stat 2>/dev/null || echo 0; }
printf '%-8s %5s %5s %5s %5s %5s %9s  %s\n' time load1 user% sys% idle% steal% thr_ms "busiest (%cpu command)" > "$file"
read -r u0 s0 i0 st0 t0 < <(cpu); th0=$(throttled)
while sleep 30; do
  read -r u s i st t < <(cpu); th=$(throttled)
  d=$(( t - t0 )); [ $d -gt 0 ] || d=1
  # top's second frame: its first gives each process's CPU over its whole life, not now.
  busy=$(top -b -n 2 -d 1 -c -w 160 -o %CPU 2>/dev/null | awk '/^top -/ { f++; n = 0 } f == 2 && /^ *PID/ { n = 1; next } f == 2 && n && n++ <= 3 { c = ""; for (k = 12; k <= NF; k++) c = c " " $k; printf "%s%s ·", $9, substr(c, 1, 60) }')
  printf '%-8s %5s %5d %5d %5d %5d %9d  %s\n' "$(date +%T)" "$(cut -d' ' -f1 /proc/loadavg)" \
    $(( 100 * (u - u0) / d )) $(( 100 * (s - s0) / d )) $(( 100 * (i - i0) / d )) $(( 100 * (st - st0) / d )) \
    $(( (${th:-0} - ${th0:-0}) / 1000 )) "$busy" >> "$file"
  u0=$u s0=$s i0=$i st0=$st t0=$t th0=$th
done
