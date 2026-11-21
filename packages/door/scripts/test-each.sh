#!/bin/sh
# Each test file alone, in its own process: a file that only passes because another file loaded a module first (an
# import cycle, a shared global) fails here. `bun test` loads every file into one process, which hides that: #204's
# cycle left 13 files unable to load alone for a day. The default is every file, test/*.test.ts and the showcase's
# test/showcase/*.test.ts (PIE-1504); parity and showcase files are slow, so pass file names to run only those.
# `--list` prints the files a run would take, one a line, and runs none. TEST_EACH_JOBS runs that many at once
# (default 1: one after another; scripts/box-test runs one per vCPU in a boxd box, 8 on float-box). Prints only the
# files that fail, each with the tests that failed in it and their assertions, then exits 1 if any did.
self=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
cd "$(dirname "$self")/.." || exit 2
if [ "$1" = --one ]; then
  # The exit code is the verdict (a run killed at the timeout, or one that crashed after its summary, fails).
  out=$(timeout 900 bun test "$2" 2>&1); code=$?
  [ $code = 0 ] && exit 0
  # Which test, and what it asserted (PIE-1816): bun prints a failing test's error, what it expected and got and where,
  # then its `(fail)` line. Those are kept, indented under the file's line: scripts/nightly-red reads them into the
  # night's ticket, and an unindented `(fail)` there would be pinned on whichever file the suite ran last. At most 8
  # lines and the place for a test, 5 tests for a file.
  said=$(printf '%s\n' "$out" | sed 's/\x1b\[[0-9;]*m//g' | awk '
    /^[0-9]+ tests? failed:$/ { exit }
    /^\(fail\) / { if (++fails <= 5) printf "%s  %s\n", block, $0; block = ""; inside = 0; next }
    /^ *\^ this test timed out/ { if (fails <= 5) { sub(/^ *\^ /, ""); print "  " $0 } next }
    /^error: / && !inside { inside = 1; n = 0; at = 0 }
    inside && NF {
      line = $0; sub(/^ +/, "", line)
      if (line ~ /^at .*:[0-9]+:[0-9]+\)?$/) { if (!at++) block = block "  " line "\n" }
      else if (n++ < 8) block = block "  " line "\n"
    }
    END { printf "%s", block; if (fails > 5) printf "  and %d more tests failed\n", fails - 5 }')
  # No test failed, and the file did: it didn't load, or was stopped at its limit.
  case $said in *"(fail) "*) ;; *) said="${said:+$said
}  no test failed: bun test exited $code$([ $code = 124 ] && echo ", stopped at the 900 s limit")";; esac
  # One printf, so files running at once don't interleave their lines.
  printf '✗ %s\n%s\n' "$2" "$said"
  exit 1
fi
if [ "${1:-}" = --list ]; then shift; list=1; else list=0; fi
files=${*:-$(ls test/*.test.ts test/showcase/*.test.ts)}
[ $list = 0 ] || { printf '%s\n' $files; exit 0; }
printf '%s\n' $files | xargs -P "${TEST_EACH_JOBS:-1}" -n 1 sh "$self" --one || exit 1
